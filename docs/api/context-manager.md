# Context Window Management

Long-running agents accumulate conversation history that can eventually exceed a model's context window. The SDK provides a `contextManager` option on every agent that automatically manages what history is sent to the model on each iteration.

## Quick Start

Pass any built-in strategy (or your own) via `contextManager`:

```ts
import { agent, anthropic, slidingWindow } from '@daedalus-ai-dev/ai-sdk';

const myAgent = agent({
  provider: anthropic('claude-opus-4-6'),
  instructions: 'You are a helpful assistant.',
  contextManager: slidingWindow(20),
});
```

---

## Built-in Strategies

### `slidingWindow(maxMessages)`

Keeps only the most recent `maxMessages` messages. The simplest strategy — zero overhead, deterministic.

Orphaned tool-result messages (whose matching tool-use was trimmed) are automatically dropped to keep the conversation well-formed.

```ts
import { slidingWindow } from '@daedalus-ai-dev/ai-sdk';

agent({
  instructions: '...',
  contextManager: slidingWindow(20), // keep last 20 messages
});
```

**When to use:** Short-term task agents where older context isn't needed.

---

### `tokenBudget(maxTokens)`

Estimates token usage (4 characters ≈ 1 token) and drops the oldest messages until the history fits within `maxTokens`. More precise than a message count when messages vary in length.

```ts
import { tokenBudget } from '@daedalus-ai-dev/ai-sdk';

agent({
  instructions: '...',
  contextManager: tokenBudget(6000), // ~6k tokens for history
});
```

**When to use:** When you want to reserve a predictable token budget for the history portion of the prompt.

---

### `summarizing(options)`

Summarizes older conversation history into a single message using an LLM call, then appends the most recent messages verbatim. The most context-efficient strategy for long conversations.

```ts
import { summarizing, anthropic } from '@daedalus-ai-dev/ai-sdk';

agent({
  instructions: '...',
  contextManager: summarizing({
    provider: anthropic('claude-haiku-4-5'),
    model: 'claude-haiku-4-5',
    keepRecent: 10,           // keep last 10 messages verbatim
    // summaryPrompt: '...',  // optional: override the summarization prompt
  }),
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `AIProvider` | required | Provider used for summarization |
| `model` | `string` | required | Model used for summarization |
| `keepRecent` | `number` | `10` | How many recent messages to keep verbatim |
| `summaryPrompt` | `string` | built-in | Custom instruction for the summary call |

**When to use:** Persistent assistants, customer support bots, research agents — anywhere long-term context matters.

**Tip:** Use a fast, cheap model (e.g. `claude-haiku-4-5`) for summarization to keep costs low.

---

## Custom Strategy

Implement the `ContextManager` interface to build your own strategy:

```ts
import type { ContextManager } from '@daedalus-ai-dev/ai-sdk';

const myStrategy: ContextManager = {
  manage(messages) {
    // Return a subset of messages — sync or async
    return messages.filter((m) => m.role !== 'system');
  },
};

agent({
  instructions: '...',
  contextManager: myStrategy,
});
```

### Interface

```ts
interface ContextManager {
  manage(messages: Message[]): Message[] | Promise<Message[]>;
}
```

---

## How It Works

The context manager is called **before every provider request** in the agentic loop. It receives the full conversation history accumulated so far and returns the slice that will be sent to the model. The full history is still preserved in the `messages` array returned in `AgentResponse`.

```
[full history] → contextManager.manage() → [managed slice] → provider.chat()
```

This means:
- The model only sees the managed slice on each request
- The returned `AgentResponse.messages` contains the **full** history
- Tool-use pairs within the managed slice are always coherent (orphaned results are dropped)
