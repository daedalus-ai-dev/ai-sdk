# Checkpointing

Serialise and restore agent state so long-running or interactive workflows can pause, survive process restarts, and resume exactly where they left off — including in stateless environments like Cloudflare Workers.

## How it works

Every `AgentResponse` now includes a `checkpoint` field containing a plain-JSON snapshot of the run state. You can save this anywhere (KV, a database, a cookie) and pass it back to `AgentRunner.resume()` in a completely new process.

For **human-in-the-loop** flows, throw an `InterruptError` inside a tool. The agent loop stops immediately and returns an `InterruptedResponse` with the question and a checkpoint that has `pendingToolUseId` set. Call `resume(checkpoint, answer)` to inject the user's reply and continue.

```
prompt("start")
  → agent runs…
  → tool throws InterruptError("Your deadline?")
  → returns InterruptedResponse  ← save checkpoint here

resume(checkpoint, "end of Q2")
  → injects tool_result
  → agent continues…
  → returns AgentResponse
```

---

## `Checkpoint`

Plain JSON — safe to serialise with `JSON.stringify`.

```ts
interface Checkpoint {
  messages: Message[];       // full conversation history
  iterations: number;        // iterations consumed (checked against maxIterations on resume)
  usage: Usage;              // accumulated token counts
  pendingToolUseId?: string; // set when the agent was interrupted
}
```

`AgentResponse` always includes a `checkpoint`, even for normal (non-interrupted) completions — useful for saving progress after each run.

---

## `InterruptError`

Throw inside a tool `handle` to pause the agent loop.

```ts
import { InterruptError, defineTool } from '@daedalus-ai-dev/ai-sdk';

const askUser = defineTool({
  name: 'ask_user',
  description: 'Ask the human a clarifying question before continuing.',
  schema: (s) => ({ question: s.string().required() }),
  handle: ({ question }) => {
    throw new InterruptError(question as string);
  },
});
```

The loop stops, no tool result is added, and an `InterruptedResponse` is returned to the caller.

---

## `InterruptedResponse`

Returned by `AgentRunner.prompt()` when a tool throws `InterruptError`.

```ts
interface InterruptedResponse {
  interrupted: true;
  question: string;                                          // the question to show the user
  checkpoint: Checkpoint & { pendingToolUseId: string };    // save this, pass to resume()
}
```

---

## `AgentRunner.resume(checkpoint, answer)`

Injects the user's answer as a tool result and continues the loop from the saved checkpoint.

```ts
async resume(
  checkpoint: Checkpoint & { pendingToolUseId: string },
  answer: string,
): Promise<AgentResponse | InterruptedResponse>
```

The agent can interrupt again (another `ask_user` call) — keep looping until the result is not interrupted.

---

## `isInterrupted(result)`

Type guard — narrows the union return type.

```ts
function isInterrupted<T>(
  result: AgentResponse<T> | InterruptedResponse,
): result is InterruptedResponse
```

---

## `assertComplete(result)`

Throws if the result is an `InterruptedResponse`. Use this when your tools never throw `InterruptError` and you want concise call sites.

```ts
function assertComplete<T>(
  result: AgentResponse<T> | InterruptedResponse,
): AgentResponse<T>
```

---

## Examples

### Stateless resume across HTTP requests (Cloudflare Workers)

```ts
import { agent, isInterrupted, assertComplete, InterruptError, defineTool } from '@daedalus-ai-dev/ai-sdk';

const askUser = defineTool({
  name: 'ask_user',
  schema: (s) => ({ question: s.string().required() }),
  handle: ({ question }) => { throw new InterruptError(question as string); },
});

const agentConfig = {
  instructions: 'You are a helpful assistant. Ask the user for any missing information.',
  tools: [askUser],
};

// ── Request 1 ────────────────────────────────────────────────────────────────

export async function handleStart(request: Request, kv: KVNamespace): Promise<Response> {
  const { message, sessionId } = await request.json();

  const result = await agent(agentConfig).prompt(message);

  if (isInterrupted(result)) {
    await kv.put(sessionId, JSON.stringify(result.checkpoint));
    return Response.json({ question: result.question });
  }

  return Response.json({ answer: result.text });
}

// ── Request 2 — new Worker instance, zero shared memory ──────────────────────

export async function handleReply(request: Request, kv: KVNamespace): Promise<Response> {
  const { answer, sessionId } = await request.json();
  const checkpoint = JSON.parse(await kv.get(sessionId) ?? 'null');

  if (!checkpoint) return new Response('Session not found', { status: 404 });

  const result = await agent(agentConfig).resume(checkpoint, answer);

  if (isInterrupted(result)) {
    await kv.put(sessionId, JSON.stringify(result.checkpoint));
    return Response.json({ question: result.question });
  }

  await kv.delete(sessionId);
  return Response.json({ answer: result.text });
}
```

### Multi-turn loop until complete

```ts
let result = await agent(agentConfig).prompt('Plan my project.');

while (isInterrupted(result)) {
  const answer = await readline.question(`\n${result.question}\n> `);
  result = await agent(agentConfig).resume(result.checkpoint, answer);
}

console.log(result.text);
```

### Recovery after failure

```ts
// Save checkpoint after every completed run
const result = assertComplete(await agent(config).prompt('Analyse the codebase.'));
await db.save('last-run', result.checkpoint);

// If the process crashes and restarts, resume from last saved checkpoint
const saved = await db.load('last-run');
if (saved) {
  const resumed = assertComplete(await agent(config).resume(saved, ''));
}
```

### Callers that never interrupt

Use `assertComplete` to avoid narrowing everywhere:

```ts
// Throws if interrupted — use when you know your tools never call InterruptError
const response = assertComplete(await agent(config).prompt('Hello'));
console.log(response.text);
```
