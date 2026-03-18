# `anthropic(model, options?)`

Creates an Anthropic provider backed by the official `@ai-sdk/anthropic` adapter.

## Signature

```ts
function anthropic(model: string, options?: AnthropicOptions): AIProvider
```

## Options

```ts
interface AnthropicOptions {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}
```

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk @ai-sdk/anthropic
```

## Examples

### Basic usage

```ts
import { agent, configure, anthropic } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-sonnet-4-5') });

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('Explain monads in one paragraph.');
```

### Explicit API key

```ts
configure({
  provider: anthropic('claude-opus-4-6', { apiKey: process.env.MY_ANTHROPIC_KEY }),
});
```

## Popular model IDs

| Model | Notes |
|-------|-------|
| `claude-opus-4-6` | Most capable, best for complex tasks |
| `claude-sonnet-4-6` | Balanced performance and speed |
| `claude-sonnet-4-5` | Fast, cost-efficient |
| `claude-haiku-4-5-20251001` | Fastest and most compact |

See the [Anthropic models documentation](https://docs.anthropic.com/en/docs/about-claude/models) for the full list.
