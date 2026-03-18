---
layout: home

hero:
  name: "Rokkhopper AI SDK"
  text: "Build agents that think, act, and collaborate"
  tagline: A TypeScript-first SDK for crafting LLM agents, custom tools, and multi-agent workflows — provider-agnostic and production-ready.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/rokkhopper/ai-sdk

features:
  - icon: 🤖
    title: Agent-first API
    details: Define agents with a simple fluent interface or class-based syntax. The SDK handles the agentic loop, tool execution, and retry logic automatically.

  - icon: 🔧
    title: Composable Tools
    details: Build custom tools with a typed schema builder and plug them into any agent. Built-in WebFetch tool included out of the box.

  - icon: 🔀
    title: Multi-agent Patterns
    details: Prompt chaining, routing, parallelization, orchestrator-workers, and evaluator-optimizer — all the patterns from Anthropic's building-effective-agents playbook.

  - icon: 📐
    title: Structured Output
    details: Define a JSON Schema with a fluent builder and get strongly typed, validated structured data back from any model.

  - icon: 🔌
    title: Provider-agnostic
    details: Swap AI providers by changing one line. Ships with an OpenRouter adapter. Implement the two-method AIProvider interface to add any model API.

  - icon: 🌊
    title: Streaming
    details: First-class async generator streaming with tool calls handled transparently mid-stream.
---
