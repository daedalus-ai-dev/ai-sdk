import * as log from './logger.js';
import type { AIProvider, ChatRequest, StreamChunk } from './types.js';

// ─── Retriable error detection ────────────────────────────────────────────────

/**
 * Returns `true` for errors that are safe to retry:
 * - HTTP 429 (rate limit) and 5xx server errors
 * - Network/connection failures (TypeError from fetch)
 */
export function isRetriableError(error: unknown): boolean {
  if (error != null && typeof error === 'object') {
    const status =
      (error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode;
    if (typeof status === 'number') {
      if (status === 429 || (status >= 500 && status <= 599)) return true;
    }
  }
  if (error instanceof Error) {
    // OpenRouter-style messages: "OpenRouter error 429: ..."
    if (/\b(429|500|502|503|504)\b/.test(error.message)) return true;
    // fetch network failures
    if (error instanceof TypeError) return true;
  }
  return false;
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

function backoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const base = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return base + Math.random() * base * 0.1; // ±10% jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── withRetry ────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: `3` */
  maxAttempts?: number;
  /** Base delay before the first retry (ms). Doubles on each attempt. Default: `1000` */
  baseDelayMs?: number;
  /** Maximum delay after backoff (ms). Default: `30_000` */
  maxDelayMs?: number;
  /**
   * Custom predicate — return `true` to retry, `false` to throw immediately.
   * Defaults to {@link isRetriableError}.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Wrap a provider with automatic retry on transient failures using exponential
 * backoff with jitter.
 *
 * ```ts
 * const provider = withRetry(openai('gpt-4o'), { maxAttempts: 4 });
 * ```
 *
 * By default, retries on HTTP 429, 5xx, and network errors. Pass
 * `shouldRetry` to customise.
 */
export function withRetry(provider: AIProvider, options: RetryOptions = {}): AIProvider {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const shouldRetry = options.shouldRetry ?? isRetriableError;

  async function attempt<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (error) {
        const isLast = i === maxAttempts - 1;
        if (isLast || !shouldRetry(error, i + 1)) throw error;
        const delay = backoffMs(i, baseDelayMs, maxDelayMs);
        log.retryAttempt(i + 1, maxAttempts, delay, error);
        await sleep(delay);
      }
    }
    /* c8 ignore next */
    throw new Error('withRetry: unreachable');
  }

  return {
    chat: (request: ChatRequest) => attempt(() => provider.chat(request)),

    async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
      // Streaming: retry by restarting the stream from the beginning.
      // Note: if chunks were already yielded before the error, the caller
      // will receive duplicate content on retry. Use withRetry for
      // connection-phase failures only, not mid-stream errors.
      for (let i = 0; i < maxAttempts; i++) {
        try {
          yield* provider.stream(request);
          return;
        } catch (error) {
          const isLast = i === maxAttempts - 1;
          if (isLast || !shouldRetry(error, i + 1)) throw error;
          const delay = backoffMs(i, baseDelayMs, maxDelayMs);
          log.retryAttempt(i + 1, maxAttempts, delay, error);
          await sleep(delay);
        }
      }
    },
  };
}

// ─── withFallback ─────────────────────────────────────────────────────────────

/**
 * Chain multiple providers into a fallback sequence. The first provider is
 * tried; on any failure the next is tried, until one succeeds or all are
 * exhausted (in which case the last error is re-thrown).
 *
 * ```ts
 * const provider = withFallback(
 *   openai('gpt-4o'),
 *   anthropic('claude-3-5-sonnet-20241022'),
 * );
 * ```
 *
 * Compose with {@link withRetry} for retry-then-fallback behaviour:
 *
 * ```ts
 * const provider = withRetry(
 *   withFallback(openai('gpt-4o'), anthropic('claude-3-5-sonnet-20241022')),
 *   { maxAttempts: 2 },
 * );
 * ```
 */
export function withFallback(...providers: AIProvider[]): AIProvider {
  if (providers.length === 0) throw new Error('withFallback requires at least one provider');

  async function tryAll<T>(fn: (p: AIProvider, i: number) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < providers.length; i++) {
      try {
        // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop
        return await fn(providers[i]!, i);
      } catch (error) {
        lastError = error;
        if (i < providers.length - 1) {
          log.fallbackActivated(i + 1, providers.length, error);
        }
      }
    }
    throw lastError;
  }

  return {
    chat: (request: ChatRequest) => tryAll((p) => p.chat(request)),

    async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
      let lastError: unknown;
      for (let i = 0; i < providers.length; i++) {
        try {
          // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop
          yield* providers[i]!.stream(request);
          return;
        } catch (error) {
          lastError = error;
          if (i < providers.length - 1) {
            log.fallbackActivated(i + 1, providers.length, error);
          }
        }
      }
      throw lastError;
    },
  };
}
