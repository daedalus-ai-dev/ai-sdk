# `createProvider(options)`

A factory function that creates any built-in provider from a plain options object. Useful for configuration-driven or environment-variable-driven setups where the provider name comes from config rather than code.

## Signature

```ts
function createProvider(options: CreateProviderOptions & { model: string }): AIProvider

type BuiltInProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter';
```

## Options

All options include `provider` (the provider name) and `model` (the model ID). Additional fields depend on the provider:

| Provider | Extra fields |
|----------|-------------|
| `openai` | `apiKey?`, `baseUrl?` |
| `anthropic` | `apiKey?` |
| `google` | `apiKey?` |
| `xai` | `apiKey?` |
| `openrouter` | `apiKey?` |

## Examples

### From environment variables

```ts
import { configure, createProvider, type BuiltInProvider } from '@daedalus-ai-dev/ai-sdk';

configure({
  provider: createProvider({
    provider: process.env.AI_PROVIDER as BuiltInProvider,
    model:    process.env.AI_MODEL!,
    apiKey:   process.env.AI_API_KEY,
  }),
});
```

### Static config

```ts
import { createProvider } from '@daedalus-ai-dev/ai-sdk';

const provider = createProvider({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
```

### Multi-environment config file

```ts
// config.ts
import { createProvider } from '@daedalus-ai-dev/ai-sdk';

const configs = {
  development: { provider: 'openai',     model: 'gpt-4o-mini' },
  production:  { provider: 'anthropic',  model: 'claude-sonnet-4-5' },
  staging:     { provider: 'google',     model: 'gemini-2.5-flash' },
} as const;

export const aiProvider = createProvider(configs[process.env.NODE_ENV ?? 'development']);
```

## Notes

- For OpenRouter, `model` is baked into the returned provider (unlike using `openrouter()` directly where model is set via `configure({ model })`).
- All providers fall through to their `apiKey` option; if omitted, the standard environment variable for that provider is used automatically (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`).
