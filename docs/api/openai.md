# `openai(model, options?)`

Creates an OpenAI provider backed by the official `@ai-sdk/openai` adapter.

## Signature

```ts
function openai(model: string, options?: OpenAIOptions): AIProvider
```

## Options

```ts
interface OpenAIOptions {
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Override the base URL (e.g. Azure OpenAI or a local proxy). */
  baseUrl?: string;
}
```

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk @ai-sdk/openai
```

## Examples

### Basic usage

```ts
import { agent, configure, openai } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: openai('gpt-4o') });

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('What is the capital of France?');
```

### Explicit API key

```ts
configure({
  provider: openai('gpt-4o-mini', { apiKey: process.env.MY_OPENAI_KEY }),
});
```

### Azure OpenAI

```ts
configure({
  provider: openai('my-deployment', {
    apiKey: process.env.AZURE_OPENAI_KEY,
    baseUrl: 'https://my-resource.openai.azure.com/openai/deployments',
  }),
});
```

## Popular model IDs

| Model | Notes |
|-------|-------|
| `gpt-4o` | Flagship multimodal model |
| `gpt-4o-mini` | Fast, cost-efficient |
| `o3` | Advanced reasoning |
| `o4-mini` | Fast reasoning |

See the [OpenAI models documentation](https://platform.openai.com/docs/models) for the full list.
