# `google(model, options?)`

Creates a Google AI (Gemini) provider backed by the official `@ai-sdk/google` adapter.

## Signature

```ts
function google(model: string, options?: GoogleOptions): AIProvider
```

## Options

```ts
interface GoogleOptions {
  /** Google AI API key. Defaults to GOOGLE_GENERATIVE_AI_API_KEY env var. */
  apiKey?: string;
}
```

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk @ai-sdk/google
```

## Examples

### Basic usage

```ts
import { agent, configure, google } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: google('gemini-2.5-flash') });

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('Summarise the water cycle in three sentences.');
```

### Explicit API key

```ts
configure({
  provider: google('gemini-2.5-pro', { apiKey: process.env.MY_GOOGLE_KEY }),
});
```

## Popular model IDs

| Model | Notes |
|-------|-------|
| `gemini-2.5-pro` | Most capable Gemini model |
| `gemini-2.5-flash` | Fast and cost-efficient |
| `gemini-2.0-flash` | Previous generation flash |

See the [Google AI model documentation](https://ai.google.dev/gemini-api/docs/models) for the full list.
