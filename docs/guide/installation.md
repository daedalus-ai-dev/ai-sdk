# Installation

## Requirements

- **Node.js** 20 or later (for native `fetch` and `TextDecoder`)
- **TypeScript** 5.4 or later (for `exactOptionalPropertyTypes` compatibility)

## Install the package

::: code-group

```sh [npm]
npm install @daedalus-ai-dev/ai-sdk
```

```sh [pnpm]
pnpm add @daedalus-ai-dev/ai-sdk
```

```sh [yarn]
yarn add @daedalus-ai-dev/ai-sdk
```

:::

## TypeScript configuration

Add the following to your `tsconfig.json`. The SDK uses ES2022 features and Node's native ESM resolution.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true
  }
}
```

The `"DOM"` lib entry is required for the native `fetch` type definitions, which are used by the OpenRouter provider.

## Get an API key

The SDK ships with an [OpenRouter](https://openrouter.ai) adapter out of the box. OpenRouter is a single endpoint that routes to 200+ models (OpenAI, Anthropic, Mistral, Llama, and more).

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Create an API key in your dashboard
3. Store it as an environment variable:

```sh
export OPENROUTER_API_KEY=sk-or-...
```

Prefer a `.env` file in local development:

```sh
OPENROUTER_API_KEY=sk-or-...
```

Use a package like [`dotenv`](https://github.com/motdotla/dotenv) or Node's built-in `--env-file` flag to load it:

```sh
node --env-file=.env dist/index.js
```

## Verify your setup

Create a `hello.ts` file:

```ts
import { agent, configure, openrouter } from '@daedalus-ai-dev/ai-sdk';

configure({
  provider: openrouter({ apiKey: process.env.OPENROUTER_API_KEY! }),
  model: 'openai/gpt-4o-mini',
});

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('Say hello in one sentence.');

console.log(response.text);
```

Run it:

```sh
npx tsx hello.ts
```

You should see a greeting from the model. If you get an authentication error, double-check your `OPENROUTER_API_KEY`.
