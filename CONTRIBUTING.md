# Contributing to Daedalus AI SDK

Thank you for your interest in contributing! This document covers how to get set up, our coding conventions, and the pull request process.

## Getting started

**Prerequisites:** Node.js ≥ 20, npm ≥ 10.

```bash
git clone https://github.com/daedalus-ai-dev/ai-sdk.git
cd ai-sdk
npm install
```

## Development workflow

| Command | Description |
|---------|-------------|
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run docs:dev` | Start the VitePress dev server |
| `npm run docs:build` | Build the static documentation site |

## Project structure

```
src/
  agent.ts          # Core agentic loop and AgentRunner
  types.ts          # All shared TypeScript types
  schema.ts         # Fluent JSON Schema builder
  tool.ts           # Tool interface and defineTool()
  pipeline.ts       # Pipeline<T> for prompt chaining
  providers/        # Provider adapters (openai, anthropic, google, …)
  tools/            # Built-in tools (WebFetch)
  mcp/              # MCP client (connectMcp)
docs/               # VitePress documentation
```

## Making changes

1. **Fork** the repository and create a branch from `main`.
2. **Write tests** for any new behaviour — we use [Vitest](https://vitest.dev/).
3. **Keep providers thin.** Each provider in `src/providers/` should be a minimal adapter. Business logic belongs in `agent.ts`.
4. **Run the full suite** before opening a PR: `npm run test:run && npm run build`.
5. **One concern per PR.** Small, focused pull requests are reviewed faster.

## Adding a new provider

1. Create `src/providers/my-provider.ts` implementing `AIProvider` (see `src/types.ts`).
2. Export it from `src/index.ts`.
3. Add a corresponding doc page at `docs/api/my-provider.md`.
4. Add the sidebar entry in `docs/.vitepress/config.ts`.
5. Write at least a unit test mocking the underlying network calls.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Groq provider
fix: handle empty tool result content
docs: document createProvider factory
chore: bump @ai-sdk/* to latest
```

## Reporting issues

Please open an issue on [GitHub](https://github.com/daedalus-ai-dev/ai-sdk/issues) with:

- A minimal reproduction or code snippet
- The SDK version (`npm list @daedalus-ai-dev/ai-sdk`)
- Node.js version (`node --version`)

## Code of conduct

Be respectful and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.
