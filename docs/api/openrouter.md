# `openrouter(options)`

Creates an `OpenRouterProvider` that implements `AIProvider` using the OpenRouter API — a unified endpoint for 200+ models.

## Signature

```ts
function openrouter(options: OpenRouterOptions): OpenRouterProvider

interface OpenRouterOptions {
  /** OpenRouter API key (sk-or-...) */
  apiKey: string;
  /** Default model identifier. Optional — overridden by per-agent model. */
  defaultModel?: string;
  /** API base URL. Defaults to 'https://openrouter.ai/api/v1'. */
  baseUrl?: string;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}
```

## Usage

```ts
import { openrouter, configure } from '@rokkhopper/ai-sdk';

configure({
  provider: openrouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
    headers: {
      'HTTP-Referer': 'https://myapp.com',  // Recommended for OpenRouter analytics
      'X-Title': 'My Application',
    },
  }),
  model: 'openai/gpt-4o-mini',
});
```

## Selecting models

OpenRouter uses the format `provider/model-name`. Common choices:

| Model | Identifier | Best for |
|-------|-----------|----------|
| GPT-4o mini | `openai/gpt-4o-mini` | Fast tasks, classification, simple Q&A |
| GPT-4o | `openai/gpt-4o` | Balanced capability and speed |
| Claude 3.5 Sonnet | `anthropic/claude-3-5-sonnet` | Complex reasoning, long-form writing |
| Claude 3 Haiku | `anthropic/claude-3-haiku` | Ultra-fast, cheap |
| Gemini Flash 1.5 | `google/gemini-flash-1.5` | Large context, fast |
| Llama 3.3 70B | `meta-llama/llama-3.3-70b-instruct` | Open-source, cost-effective |

See the full list at [openrouter.ai/models](https://openrouter.ai/models).

## Structured output (JSON Schema)

When a `schema` is provided and no tools are active, the provider sends the schema as a `response_format` with `strict: true`. This constrains the model to return valid JSON matching the schema.

```ts
const response = await agent({
  instructions: 'Extract product details.',
  schema: (s) => ({
    name:  s.string().required(),
    price: s.number().min(0).required(),
  }),
}).prompt('Blue Widget — $12.99');

// response.structured is parsed JSON
```

::: warning Model compatibility
Not all models support `response_format: json_schema`. GPT-4o and GPT-4o-mini have the best structured output support. For other models, consider asking the model to return JSON in the prompt and parsing `response.text` manually.
:::

## Tool calling

The provider maps `Tool[]` to OpenAI-compatible function definitions and handles tool call parsing automatically. Tool calls within a single turn are executed in parallel.

## Streaming

The provider implements Server-Sent Events (SSE) streaming and reassembles tool call deltas across chunks transparently.

## Using a self-hosted endpoint

Point to any OpenAI-compatible API:

```ts
const provider = openrouter({
  apiKey: 'my-local-key',
  baseUrl: 'http://localhost:11434/v1',  // e.g. Ollama
});
```

## `OpenRouterProvider` class

You can also instantiate the class directly if you prefer:

```ts
import { OpenRouterProvider } from '@rokkhopper/ai-sdk';

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
});
```
