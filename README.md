# Daedalus AI SDK

A TypeScript SDK for building agents, tools, and multi-agent workflows — provider-agnostic, composable, and designed for production.

[![npm version](https://img.shields.io/npm/v/@daedalus-ai-dev/ai-sdk)](https://www.npmjs.com/package/@daedalus-ai-dev/ai-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- **Agentic loop** — automatic tool-use cycles until the model signals completion
- **Provider-agnostic** — OpenAI, Anthropic, Google, xAI, OpenRouter, or any Vercel AI SDK model
- **MCP support** — connect to any [Model Context Protocol](https://modelcontextprotocol.io) server as a tool source
- **Multi-agent patterns** — Prompt Chaining, Routing, Parallelization, Orchestrator-Workers, Evaluator-Optimizer
- **Fluent schema builder** — define tool input schemas with a type-safe builder API
- **Streaming** — first-class async generator streaming with tool-use support

## Installation

```bash
npm install @daedalus-ai-dev/ai-sdk
```

Install the provider package for your preferred model:

```bash
npm install @ai-sdk/openai       # OpenAI
npm install @ai-sdk/anthropic    # Anthropic
npm install @ai-sdk/google       # Google Gemini
npm install @ai-sdk/xai          # xAI Grok
```

## Quick start

```ts
import { agent, configure, anthropic } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-sonnet-4-5') });

const response = await agent({
  instructions: 'You are a helpful assistant.',
}).prompt('What is the capital of France?');

console.log(response.text); // Paris
```

## Tools

```ts
import { agent, configure, defineTool, openai } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: openai('gpt-4o') });

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  schema: (s) => ({
    city: s.string().description('City name').required(),
  }),
  async handle({ city }) {
    return `The weather in ${city} is sunny and 22°C.`;
  },
});

const response = await agent({
  instructions: 'You are a weather assistant.',
  tools: [weatherTool],
}).prompt('What is the weather in Tokyo?');
```

## MCP servers

Connect to any MCP server and use its tools directly:

```ts
import { agent, configure, connectMcp, anthropic } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-sonnet-4-5') });

const { tools, disconnect } = await connectMcp({
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'gitnexus@latest', 'mcp'],
});

const response = await agent({
  instructions: 'Analyse the codebase.',
  tools,
}).prompt('What functions call agent()?');

await disconnect();
```

## Multi-agent patterns

```ts
import { agent, configure, defineTool, anthropic } from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-sonnet-4-5') });

// Orchestrator-Workers: delegate subtasks to specialised sub-agents
const reviewTool = defineTool({
  name: 'review_code',
  description: 'Delegate a code review to a specialist agent.',
  schema: (s) => ({ code: s.string().required() }),
  async handle({ code }) {
    return agent({
      instructions: 'You are a senior code reviewer. Be concise and constructive.',
    }).then((runner) => runner.prompt(`Review this code:\n${code}`))
      .then((r) => r.text);
  },
});

const orchestrator = agent({
  instructions: 'You coordinate code review tasks.',
  tools: [reviewTool],
});
```

See the [Patterns guide](https://daedalus-ai-dev.github.io/ai-sdk/patterns/overview) for all five patterns with full examples.

## Providers

| Import | Provider | Env var |
|--------|----------|---------|
| `openai('gpt-4o')` | OpenAI | `OPENAI_API_KEY` |
| `anthropic('claude-sonnet-4-5')` | Anthropic | `ANTHROPIC_API_KEY` |
| `google('gemini-2.5-flash')` | Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `xai('grok-3')` | xAI Grok | `XAI_API_KEY` |
| `openrouter({ apiKey })` | OpenRouter (150+ models) | — |
| `vercelAI({ model })` | Any Vercel AI SDK model | — |

```ts
// Config-driven provider selection
import { createProvider } from '@daedalus-ai-dev/ai-sdk';

configure({
  provider: createProvider({
    provider: process.env.AI_PROVIDER,
    model:    process.env.AI_MODEL,
    apiKey:   process.env.AI_API_KEY,
  }),
});
```

## Documentation

Full documentation at **[daedalus-ai-dev.github.io/ai-sdk](https://daedalus-ai-dev.github.io/ai-sdk/)**.

- [Getting Started](https://daedalus-ai-dev.github.io/ai-sdk/guide/getting-started)
- [Agents](https://daedalus-ai-dev.github.io/ai-sdk/guide/agents)
- [Tools](https://daedalus-ai-dev.github.io/ai-sdk/guide/tools)
- [MCP Tools](https://daedalus-ai-dev.github.io/ai-sdk/guide/mcp)
- [Multi-Agent Patterns](https://daedalus-ai-dev.github.io/ai-sdk/patterns/overview)
- [API Reference](https://daedalus-ai-dev.github.io/ai-sdk/api/agent)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
