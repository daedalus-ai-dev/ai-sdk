# Agents

An agent is a configured LLM caller that can use tools, maintain conversation history, and return structured or plain-text responses. The SDK provides two ways to define agents.

## Functional style — `agent()`

The `agent()` helper is the quickest way to create a one-off or inline agent:

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

const response = await agent({
  instructions: 'You are a senior TypeScript engineer.',
  model: 'anthropic/claude-3-5-sonnet',  // overrides global default
}).prompt('Explain TypeScript mapped types.');

console.log(response.text);
```

### Config options

| Option | Type | Description |
|--------|------|-------------|
| `instructions` | `string` | System prompt — tells the model its role and constraints |
| `tools` | `Tool[]` | Tools the agent can call |
| `schema` | `SchemaFn` | Structured output schema |
| `model` | `string` | Model identifier (overrides global default) |
| `provider` | `AIProvider` | Provider instance (overrides global default) |
| `maxIterations` | `number` | Max agentic loop iterations (default: `10`) |
| `temperature` | `number` | Sampling temperature |
| `maxTokens` | `number` | Max output tokens |

## Class-based style — `AgentInterface`

For reusable agents, implement the `AgentInterface`:

```ts
import type { AgentInterface } from '@daedalus-ai-dev/ai-sdk';
import { runAgent, WebFetch } from '@daedalus-ai-dev/ai-sdk';

class ResearchAssistant implements AgentInterface {
  instructions() {
    return `You are a research assistant. Search the web to answer questions accurately.
    Always cite your sources.`;
  }

  tools() {
    return [new WebFetch()];
  }

  model() {
    return 'anthropic/claude-3-5-sonnet';
  }
}

const response = await runAgent(new ResearchAssistant(), 'What is quantum entanglement?');
console.log(response.text);
```

### AgentInterface methods

| Method | Required | Description |
|--------|----------|-------------|
| `instructions()` | Yes | Returns the system prompt string |
| `tools()` | No | Returns `Tool[]` |
| `schema` | No | `SchemaFn` property for structured output |
| `model()` | No | Returns a model identifier string |

## The agentic loop

When an agent has tools, the SDK runs a loop automatically:

```
┌─────────────────────────────────────────────────┐
│  Send messages + tool definitions to model       │
└──────────────────────────┬──────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  end_turn?  │ ──── Yes ──► Return AgentResponse
                    └──────┬──────┘
                           │ No (tool_use)
                    ┌──────▼──────────────────────┐
                    │  Execute all tool calls      │
                    │  (in parallel)               │
                    └──────┬──────────────────────┘
                           │
                    ┌──────▼──────────────────────┐
                    │  Append tool results         │
                    │  to message history          │
                    └──────┬──────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  iterations │
                    │  < max?     │ ──── No ──► throw Error
                    └──────┬──────┘
                           │ Yes
                           └────────────────────────► (repeat)
```

Tool calls within the same turn are executed in parallel using `Promise.all`.

## Agent response

`.prompt()` returns an `AgentResponse<T>`:

```ts
interface AgentResponse<T = unknown> {
  text: string;           // Raw text of the final assistant message
  structured: T;          // Parsed JSON (only when schema is set)
  usage: Usage;           // Accumulated token usage across all iterations
  messages: Message[];    // Full conversation history
}
```

### Accumulating usage

`usage` is the **sum** across all model calls in the agentic loop, making it suitable for billing or rate-limiting purposes:

```ts
const response = await agent({ instructions: '...', tools: [myTool] }).prompt('...');
console.log(`Total tokens: ${response.usage.inputTokens + response.usage.outputTokens}`);
```

## Conversation history

Pass prior messages to continue a conversation:

```ts
const history: Message[] = [];

const first = await agent({ instructions: 'You are a helpful assistant.' })
  .prompt('My name is Alice.', history);

// Add the exchange to history
history.push(...first.messages.slice(-2)); // user + assistant messages

const second = await agent({ instructions: 'You are a helpful assistant.' })
  .prompt('What is my name?', history);

console.log(second.text); // "Your name is Alice."
```

::: tip
Store `response.messages` in a database and replay them as `history` to create persistent, stateful conversations.
:::

## Per-agent provider and model

You can override the global provider or model on a per-agent basis:

```ts
import { agent, openrouter } from '@daedalus-ai-dev/ai-sdk';

// This agent uses a different provider entirely
const response = await agent({
  instructions: 'You are an expert mathematician.',
  provider: openrouter({ apiKey: process.env.OPENROUTER_API_KEY! }),
  model: 'google/gemini-flash-1.5',
}).prompt('Prove that √2 is irrational.');
```
