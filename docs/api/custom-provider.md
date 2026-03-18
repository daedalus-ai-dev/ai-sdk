# Custom Provider

Implement the `AIProvider` interface to connect the SDK to any model API.

## Interface

```ts
interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
}
```

## `ChatRequest`

```ts
interface ChatRequest {
  model: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  responseFormat?: {
    type: 'json_schema';
    schema: JsonSchemaObject;
    name: string;
  };
  maxTokens?: number;
  temperature?: number;
}
```

## `ChatResponse`

```ts
interface ChatResponse {
  id: string;
  content: MessageContent[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { inputTokens: number; outputTokens: number };
}
```

## `StreamChunk`

```ts
interface StreamChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end';
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInputDelta?: string;
  stopReason?: StopReason;
  usage?: Usage;
}
```

## Complete example — Anthropic direct

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, ChatRequest, ChatResponse, StreamChunk } from '@rokkhopper/ai-sdk';

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const tools = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: this.mapMessages(request.messages),
      tools: tools?.length ? tools : undefined,
    });

    return {
      id: response.id,
      content: response.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }),
      stopReason: this.mapStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.systemPrompt,
      messages: this.mapMessages(request.messages),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      } else if (event.type === 'message_stop') {
        const finalMessage = await stream.finalMessage();
        yield {
          type: 'message_end',
          stopReason: this.mapStopReason(finalMessage.stop_reason),
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
          },
        };
      }
    }
  }

  private mapMessages(messages: import('@rokkhopper/ai-sdk').Message[]) {
    // Map SDK Message[] to Anthropic MessageParam[]
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : '(complex content)',
      }));
  }

  private mapStopReason(reason: string | null): import('@rokkhopper/ai-sdk').StopReason {
    switch (reason) {
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'max_tokens';
      default: return 'end_turn';
    }
  }
}
```

Usage:

```ts
import { configure } from '@rokkhopper/ai-sdk';
import { AnthropicProvider } from './providers/anthropic.js';

configure({
  provider: new AnthropicProvider(process.env.ANTHROPIC_API_KEY!),
  model: 'claude-3-5-sonnet-20241022',
});
```

## Testing with a mock provider

```ts
import type { AIProvider, ChatResponse } from '@rokkhopper/ai-sdk';

export function mockProvider(responses: Partial<ChatResponse>[]): AIProvider {
  let call = 0;
  return {
    async chat(): Promise<ChatResponse> {
      const response = responses[call++] ?? responses[responses.length - 1]!;
      return {
        id: 'mock-id',
        content: [{ type: 'text', text: 'mock response' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
        ...response,
      };
    },
    async *stream(): AsyncGenerator<never> {},
  };
}

// In tests:
const response = await agent({
  instructions: 'Test agent.',
  provider: mockProvider([
    { content: [{ type: 'text', text: 'Hello, world!' }] },
  ]),
}).prompt('Hi');
```
