# Token Budget

Cap cumulative token usage for a provider instance. Useful for bounding the cost of `refine()` loops, long workflows, or any multi-call agent session.

## `withTokenBudget(provider, options)`

Wraps any provider. After each response the accumulated usage is checked; if any limit is exceeded a `TokenBudgetExceededError` is thrown, aborting the current agent loop.

The counter is **per-wrapper-instance** — scoping is up to you:

```ts
import { withTokenBudget, openai } from '@daedalus-ai-dev/ai-sdk';

// Shared across all agents in this session
const provider = withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 50_000 });
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `maxTotalTokens` | `number` | Abort when `inputTokens + outputTokens` exceeds this |
| `maxInputTokens` | `number` | Abort when `inputTokens` exceeds this |
| `maxOutputTokens` | `number` | Abort when `outputTokens` exceeds this |

At least one limit must be provided. Multiple limits can be combined — the first one exceeded triggers the error.

## `TokenBudgetExceededError`

```ts
class TokenBudgetExceededError extends Error {
  used:  { inputTokens: number; outputTokens: number };
  limit: { maxTotalTokens?: number; maxInputTokens?: number; maxOutputTokens?: number };
}
```

Catch it to implement graceful degradation:

```ts
import { TokenBudgetExceededError, withTokenBudget, openai } from '@daedalus-ai-dev/ai-sdk';

const provider = withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 20_000 });

try {
  const result = await refine({ state, step, until, maxIterations: 10 });
  console.log('Done:', result.output);
} catch (e) {
  if (e instanceof TokenBudgetExceededError) {
    console.warn(`Budget exceeded after ${e.used.inputTokens + e.used.outputTokens} tokens`);
    // use partial result, fall back, or alert
  } else {
    throw e;
  }
}
```

## Scoping the budget

**Per-refine loop** — create a fresh wrapper for each run so counters don't bleed between runs:

```ts
async function runWithBudget(state: State) {
  const provider = withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 10_000 });
  return refine({ state, step: (s) => step(s, provider), until, maxIterations: 5 });
}
```

**Per-workflow run** — pass the wrapped provider to every skill/agent inside the workflow:

```ts
const provider = withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 30_000 });

const result = await reviewPipeline.run(post);
// All skills/agents inside the workflow share this budget
```

## Composing with retry

Wrap the budget provider with `withRetry` so transient errors are retried but budget errors are not (they are not retriable by default):

```ts
import { withRetry, withTokenBudget, openai } from '@daedalus-ai-dev/ai-sdk';

const provider = withRetry(
  withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 20_000 }),
  { maxAttempts: 3 },
);
```
