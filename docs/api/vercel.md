# `vercelAI(options)`

A low-level provider adapter that wraps **any** [Vercel AI SDK `LanguageModel`](https://sdk.vercel.ai/docs/foundations/providers-and-models) as an `AIProvider`. All the built-in provider shortcuts (`openai()`, `anthropic()`, `google()`, `xai()`) are thin wrappers around this function.

Use `vercelAI()` directly when you need a provider that doesn't have a dedicated shortcut yet — Mistral, Cohere, Groq, AWS Bedrock, and [dozens more](https://sdk.vercel.ai/providers/ai-sdk-providers) are all supported.

## Signature

```ts
function vercelAI(options: VercelAIOptions): AIProvider
```

## Options

```ts
interface VercelAIOptions {
  /**
   * A Vercel AI SDK LanguageModel instance.
   * The model is fixed here — ChatRequest.model is ignored.
   */
  model: LanguageModel;
}
```

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk ai
# Plus whichever @ai-sdk/* provider package you need
npm install @ai-sdk/mistral
```

## Examples

### Mistral

```ts
import { agent, configure, vercelAI } from '@daedalus-ai-dev/ai-sdk';
import { mistral } from '@ai-sdk/mistral';

configure({ provider: vercelAI({ model: mistral('mistral-large-latest') }) });
```

### Groq

```ts
import { createGroq } from '@ai-sdk/groq';
import { vercelAI } from '@daedalus-ai-dev/ai-sdk';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

configure({ provider: vercelAI({ model: groq('llama-3.3-70b-versatile') }) });
```

### AWS Bedrock

```ts
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { vercelAI } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: vercelAI({ model: bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0') }) });
```

### Ollama (local models)

```ts
import { ollama } from 'ollama-ai-provider';
import { vercelAI } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: vercelAI({ model: ollama('llama3.2') }) });
```

## Notes

- **Model is fixed** — the `model` string inside `ChatRequest` is ignored; the model you pass in `VercelAIOptions` is always used. This is by design: the Vercel AI SDK embeds the model in the `LanguageModel` object.
- **Streaming** uses `streamText()` and maps Vercel AI SDK v6 stream events (`tool-input-start/delta/end`, `finish-step`) to the SDK's `StreamChunk` format.
- **Structured output** (`schema` option on `agent()`) is not yet supported through this adapter; use the [`openrouter()`](/api/openrouter) provider for structured output.
