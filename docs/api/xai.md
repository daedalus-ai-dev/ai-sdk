# `xai(model, options?)`

Creates an xAI (Grok) provider backed by the official `@ai-sdk/xai` adapter.

## Signature

```ts
function xai(model: string, options?: XAIOptions): AIProvider
```

## Options

```ts
interface XAIOptions {
  /** xAI API key. Defaults to XAI_API_KEY env var. */
  apiKey?: string;
}
```

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk @ai-sdk/xai
```

## Examples

### Basic usage

```ts
import { agent, configure, xai } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: xai('grok-3') });

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('What makes large language models tick?');
```

### Explicit API key

```ts
configure({
  provider: xai('grok-3-mini', { apiKey: process.env.MY_XAI_KEY }),
});
```

## Popular model IDs

| Model | Notes |
|-------|-------|
| `grok-3` | Most capable Grok model |
| `grok-3-mini` | Fast, cost-efficient |
| `grok-2-vision` | Multimodal (image input) |

See the [xAI model documentation](https://docs.x.ai/docs/models) for the full list.
