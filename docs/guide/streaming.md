# Streaming

The SDK supports real-time streaming through async generators. Use streaming when you want to display text to users as it is generated, rather than waiting for the complete response.

## Basic streaming

Call `.stream()` instead of `.prompt()`. It returns an `AsyncGenerator<string, StreamedAgentResponse>`:

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

const stream = agent({
  instructions: 'You are a storyteller.',
}).stream('Tell me a short story about a robot.');

for await (const chunk of stream) {
  process.stdout.write(chunk); // Each chunk is a string fragment
}
```

## Getting the final response

The generator's **return value** (not a yielded value) is a `StreamedAgentResponse` containing the full accumulated text, usage, and message history. Use `for await` with a variable to capture it:

```ts
const gen = agent({ instructions: '...' }).stream('...');
let result: Awaited<typeof gen> extends AsyncGenerator<infer _Y, infer R> ? R : never;

let done = false;
while (!done) {
  const { value, done: isDone } = await gen.next();
  if (isDone) {
    result = value as StreamedAgentResponse;
    done = true;
  } else {
    process.stdout.write(value);
  }
}

console.log('\nTotal tokens:', result.usage.inputTokens + result.usage.outputTokens);
```

Or use a helper pattern:

```ts
async function collectStream(
  gen: AsyncGenerator<string, StreamedAgentResponse>,
  onChunk: (text: string) => void,
): Promise<StreamedAgentResponse> {
  let result!: StreamedAgentResponse;
  for await (const chunk of gen) {
    onChunk(chunk);
  }
  // Note: the return value is not accessible in for-await; use gen.next() or
  // accumulate the text manually
  return result;
}
```

::: tip
In practice, most applications collect the streamed text manually and ignore the return value — the full text is just the concatenation of all yielded chunks.
:::

## Streaming with tools

Tool calls are handled transparently during streaming. When the model requests a tool, the SDK:

1. Buffers the tool call arguments from the stream
2. Executes the tool
3. Sends the result back to the model
4. Continues streaming the next response

From the caller's perspective, you simply see the final text chunks flow through:

```ts
import { agent, WebFetch } from '@daedalus-ai-dev/ai-sdk';

for await (const chunk of agent({
  instructions: 'You answer questions using the web.',
  tools: [new WebFetch()],
}).stream('What is on https://example.com?')) {
  process.stdout.write(chunk);
}
```

The `WebFetch` call happens silently between the model's requests — you only see the final answer stream.

## Server-Sent Events (SSE) with Hono

Stream agent responses to a browser via SSE:

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { agent } from '@daedalus-ai-dev/ai-sdk';

const app = new Hono();

app.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    for await (const chunk of agent({
      instructions: 'You are a helpful assistant.',
    }).stream(c.req.query('q') ?? '')) {
      await stream.writeSSE({ data: chunk });
    }
    await stream.writeSSE({ data: '[DONE]' });
  });
});
```

## Next.js App Router streaming

Use the Web Streams API to stream from a Next.js Route Handler:

```ts
// app/api/chat/route.ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

export async function POST(req: Request) {
  const { message } = await req.json();

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of agent({
        instructions: 'You are a helpful assistant.',
      }).stream(message)) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

## Streaming response type

```ts
interface StreamedAgentResponse {
  text: string;           // Full accumulated text
  usage: Usage;           // Accumulated token usage
  messages: Message[];    // Full conversation history
}
```
