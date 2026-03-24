# Resilience — Retry & Fallback

Two composable provider wrappers for building resilient pipelines.

## `withRetry(provider, options?)`

Wraps any provider with automatic retry on transient failures using exponential backoff with jitter.

```ts
import { withRetry, openai } from '@daedalus-ai-dev/ai-sdk';

const provider = withRetry(openai('gpt-4o'), { maxAttempts: 4 });
```

Retries on **HTTP 429** (rate limit), **5xx** server errors, and **network failures** (fetch `TypeError`). Non-retriable errors (4xx other than 429, invalid API key, etc.) are thrown immediately.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Total attempts including the first |
| `baseDelayMs` | `number` | `1000` | Base delay before first retry (ms); doubles each attempt |
| `maxDelayMs` | `number` | `30_000` | Maximum delay after backoff |
| `shouldRetry` | `(error, attempt) => boolean` | [`isRetriableError`](#isretriableerror) | Custom predicate |

### Backoff formula

```
delay = min(baseDelayMs × 2^attempt, maxDelayMs) + jitter (±10%)
```

Attempt 1: ~1s · Attempt 2: ~2s · Attempt 3: ~4s · …

### Custom retry predicate

```ts
const provider = withRetry(openai('gpt-4o'), {
  maxAttempts: 5,
  shouldRetry: (error, attempt) => {
    // retry on 429 only, give up after 3 rate-limit hits
    return (error as any).status === 429 && attempt <= 3;
  },
});
```

## `withFallback(...providers)`

Chains providers into a fallback sequence. The first provider is tried; on any failure the next is tried, until one succeeds or all are exhausted (the last error is re-thrown).

```ts
import { withFallback, openai, anthropic } from '@daedalus-ai-dev/ai-sdk';

const provider = withFallback(
  openai('gpt-4o'),
  anthropic('claude-3-5-sonnet-20241022'),
);
```

## Composing retry and fallback

The two wrappers compose freely. Two common patterns:

**Retry the whole fallback chain** — if the primary succeeds after a retry, the fallback is never used:

```ts
const provider = withRetry(
  withFallback(openai('gpt-4o'), anthropic('claude-3-5-sonnet-20241022')),
  { maxAttempts: 2 },
);
```

**Retry each provider independently** before moving to the next:

```ts
const provider = withFallback(
  withRetry(openai('gpt-4o'),           { maxAttempts: 3 }),
  withRetry(anthropic('claude-3-5-sonnet-20241022'), { maxAttempts: 2 }),
);
```

## `isRetriableError(error)`

The default retry predicate. Returns `true` for:

- Objects with `status` or `statusCode` of `429` or `500–599`
- Errors whose message contains `429`, `500`, `502`, `503`, or `504`
- `TypeError` (fetch network failure)

```ts
import { isRetriableError } from '@daedalus-ai-dev/ai-sdk';

// Extend the default behaviour
const provider = withRetry(openai('gpt-4o'), {
  shouldRetry: (err) => isRetriableError(err) || isMyCustomRetriable(err),
});
```

## With `configure({ debug: true })`

Retry and fallback events appear in the debug output:

```
↻ retry  attempt 1/2  in 1.0s  rate limit exceeded
↻ retry  attempt 2/2  in 2.1s  rate limit exceeded
⤵ fallback  trying provider 2/2  service unavailable
```
