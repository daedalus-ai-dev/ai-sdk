# `agent(config)`

Creates an `AgentRunner` from a config object and returns it for chaining. The runner is not executing until you call `.prompt()` or `.stream()`.

## Signature

```ts
function agent(config: AgentConfig): AgentRunner
```

## `AgentConfig`

```ts
interface AgentConfig {
  /** System prompt — the agent's role and instructions. */
  instructions: string;

  /** Tools the agent can call. Triggers the agentic loop when present. */
  tools?: Tool[];

  /** Schema function for structured output. */
  schema?: SchemaFn;

  /** Model identifier (e.g. 'openai/gpt-4o-mini'). Overrides global default. */
  model?: string;

  /** Provider instance. Overrides global default. */
  provider?: AIProvider;

  /** Maximum agentic loop iterations before throwing. Default: 10. */
  maxIterations?: number;

  /** Sampling temperature (0.0–2.0). */
  temperature?: number;

  /** Maximum output tokens. */
  maxTokens?: number;
}
```

## `AgentRunner.prompt<T>(input, history?)`

Runs the agent and returns a complete response, or an `InterruptedResponse` if a tool threw an [`InterruptError`](./checkpoint).

```ts
async prompt<T = unknown>(
  input: string,
  history?: Message[],
): Promise<AgentResponse<T> | InterruptedResponse>
```

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | The user message / task |
| `history` | `Message[]` | Prior conversation messages (optional) |

**Returns** `AgentResponse<T> | InterruptedResponse`

```ts
interface AgentResponse<T = unknown> {
  text: string;           // Raw text of the final assistant message
  structured: T;          // Parsed JSON (only when schema is set)
  usage: Usage;           // Accumulated token usage across all iterations
  messages: Message[];    // Full conversation including history
  checkpoint: Checkpoint; // Serialisable state — pass to resume() to continue later
}
```

Use [`isInterrupted(result)`](./checkpoint#isinterruptedresult) to narrow the union, or [`assertComplete(result)`](./checkpoint#assertcompleteresult) to throw if interrupted.

## `AgentRunner.resume(checkpoint, answer)`

Continues a paused run by injecting the user's answer as the tool result and resuming the loop. See [Checkpointing](./checkpoint) for full details.

```ts
async resume(
  checkpoint: Checkpoint & { pendingToolUseId: string },
  answer: string,
): Promise<AgentResponse<T> | InterruptedResponse>
```

## `AgentRunner.stream(input, history?)`

Streams the agent's output chunk by chunk.

```ts
async *stream(
  input: string,
  history?: Message[],
): AsyncGenerator<string, StreamedAgentResponse>
```

**Yields** `string` — text fragments as they arrive.

**Returns** (generator return value) `StreamedAgentResponse`

```ts
interface StreamedAgentResponse {
  text: string;           // Full accumulated text
  usage: Usage;           // Accumulated token usage
  messages: Message[];    // Full conversation history
}
```

## Examples

### Simple prompt

```ts
const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('What is 2 + 2?');

console.log(response.text);    // "4"
console.log(response.usage);  // { inputTokens: 20, outputTokens: 3 }
```

### With structured output

```ts
type Result = { answer: number; confidence: number };

const response = await agent({
  instructions: 'Extract the answer and your confidence level.',
  schema: (s) => ({
    answer:     s.number().required(),
    confidence: s.number().min(0).max(1).required(),
  }),
}).prompt<Result>('What is the speed of light in km/s?');

console.log(response.structured.answer);     // 299792
console.log(response.structured.confidence); // 0.99
```

### With tools

```ts
import { WebFetch } from '@daedalus-ai-dev/ai-sdk';

const response = await agent({
  instructions: 'Answer questions using the web.',
  tools: [new WebFetch()],
  maxIterations: 5,
}).prompt('What is the current Node.js LTS version?');
```

### With conversation history

```ts
const history: Message[] = [];

const r1 = await agent({ instructions: 'Be helpful.' }).prompt('My name is Bob.');
history.push(...r1.messages);

const r2 = await agent({ instructions: 'Be helpful.' }).prompt('What is my name?', history);
console.log(r2.text); // "Your name is Bob."
```

### Streaming

```ts
for await (const chunk of agent({
  instructions: 'Write a haiku about TypeScript.',
}).stream('Go.')) {
  process.stdout.write(chunk);
}
```
