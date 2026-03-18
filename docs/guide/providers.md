# Providers

A provider is the bridge between the SDK and an AI model API. The `AIProvider` interface has two methods — `chat` and `stream` — making it straightforward to add any model backend.

## Configuring the global provider

Call `configure()` once at startup:

```ts
import { configure, openrouter } from '@rokkhopper/ai-sdk';

configure({
  provider: openrouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
  }),
  model: 'openai/gpt-4o-mini',
});
```

All `agent()` calls without an explicit `provider` or `model` will use these defaults.

## OpenRouter

[OpenRouter](https://openrouter.ai) is a unified API that routes to 200+ models. It is OpenAI-compatible.

```ts
import { openrouter } from '@rokkhopper/ai-sdk';

const provider = openrouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultModel: 'openai/gpt-4o-mini',  // optional
  headers: {
    'HTTP-Referer': 'https://myapp.com',  // recommended for OpenRouter analytics
    'X-Title': 'My App',
  },
});
```

### Selecting a model

Set the model globally via `configure()`, or per-agent:

```ts
// Cheap, fast — good for classification and simple tasks
agent({ model: 'openai/gpt-4o-mini', instructions: '...' })

// Powerful — good for complex reasoning and code
agent({ model: 'anthropic/claude-3-5-sonnet', instructions: '...' })

// Large context — good for document analysis
agent({ model: 'google/gemini-flash-1.5', instructions: '...' })
```

OpenRouter's [model list](https://openrouter.ai/models) shows all available models with pricing.

## The `AIProvider` interface

To add a new provider, implement this interface:

```ts
interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
}
```

### `ChatRequest`

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

### `ChatResponse`

```ts
interface ChatResponse {
  id: string;
  content: MessageContent[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { inputTokens: number; outputTokens: number };
}
```

### `StreamChunk`

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

## Building a custom provider

Here is a complete example of a custom provider for any OpenAI-compatible API:

```ts
import type { AIProvider, ChatRequest, ChatResponse, StreamChunk } from '@rokkhopper/ai-sdk';

class MyOpenAIProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: this.mapMessages(request),
        // ... map other fields
      }),
    });

    const json = await res.json();
    return this.mapResponse(json);
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    // Implement SSE streaming
    yield { type: 'text', text: '...' };
    yield { type: 'message_end', stopReason: 'end_turn' };
  }

  private mapMessages(request: ChatRequest) { /* ... */ }
  private mapResponse(json: unknown): ChatResponse { /* ... */ }
}

// Use it
configure({ provider: new MyOpenAIProvider(process.env.OPENAI_API_KEY!) });
```

## Provider per agent

You can override the provider for a single agent, which is useful when mixing providers in one application:

```ts
const cheapProvider = openrouter({ apiKey: '...', defaultModel: 'openai/gpt-4o-mini' });
const powerfulProvider = openrouter({ apiKey: '...', defaultModel: 'anthropic/claude-opus' });

// Classification — use cheap model
const classification = await agent({
  instructions: 'Classify the input.',
  provider: cheapProvider,
}).prompt(query);

// Final answer — use powerful model
const answer = await agent({
  instructions: 'Answer the question thoroughly.',
  provider: powerfulProvider,
}).prompt(query);
```
