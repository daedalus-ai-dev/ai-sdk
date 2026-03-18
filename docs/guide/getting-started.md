# Getting Started

Daedalus AI SDK is a TypeScript library for building LLM-powered agents, tools, and multi-agent workflows. It is inspired by [Laravel's AI SDK](https://laravel.com/ai) and the patterns described in [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) by Anthropic.

## What you can build

- **Single agents** — one-shot or multi-turn prompts with system instructions
- **Tool-use agents** — agents that call your custom functions (or built-in tools) and loop until they have a final answer
- **Structured-output agents** — agents that return validated, typed JSON
- **Multi-agent workflows** — prompt chains, parallel reviewers, orchestrator-workers, evaluator-optimizers
- **Streaming interfaces** — real-time text output through async generators

## Design philosophy

**Provider-agnostic.** The `AIProvider` interface has two methods — `chat` and `stream`. You swap providers by passing a different adapter; your agent code never changes.

**Minimal by default.** The SDK has zero runtime dependencies. The schema builder, agentic loop, and pipeline are all pure TypeScript.

**Composable over inheritable.** Agents are plain objects or classes. Tools are interfaces. Pipelines are just functions. There are no magic base classes to extend.

## Next steps

- [Installation →](./installation)
- [Quick Start →](./quick-start)
- [Core concept: Agents →](./agents)
