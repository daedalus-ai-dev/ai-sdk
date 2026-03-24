import { describe, expect, it } from 'vitest';
import { isRetriableError, withFallback, withRetry } from './retry.js';
import { mockProvider } from './testing.js';
import type { AIProvider, ChatRequest, ChatResponse } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(): ChatRequest {
  return { model: 'test', messages: [{ role: 'user', content: 'hi' }] };
}

function failingProvider(error: unknown): AIProvider {
  return {
    async chat(): Promise<ChatResponse> {
      throw error;
    },
    stream() {
      // biome-ignore lint/correctness/useYield: returns an async generator that always throws
      return (async function* () {
        throw error;
      })();
    },
  };
}

function succeedAfter(failures: unknown[], successText = 'ok'): AIProvider {
  let calls = 0;
  return {
    async chat(): Promise<ChatResponse> {
      const err = failures[calls++];
      if (err) throw err;
      return {
        id: 'id',
        content: [{ type: 'text', text: successText }],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };
    },
    async *stream() {},
  };
}

// ─── isRetriableError ─────────────────────────────────────────────────────────

describe('isRetriableError()', () => {
  it('returns true for status 429', () => {
    expect(isRetriableError({ status: 429 })).toBe(true);
  });

  it('returns true for status 503', () => {
    expect(isRetriableError({ statusCode: 503 })).toBe(true);
  });

  it('returns true for status 500', () => {
    expect(isRetriableError({ status: 500 })).toBe(true);
  });

  it('returns false for status 400 (bad request)', () => {
    expect(isRetriableError({ status: 400 })).toBe(false);
  });

  it('returns false for status 401 (auth)', () => {
    expect(isRetriableError({ status: 401 })).toBe(false);
  });

  it('returns true when status code appears in error message', () => {
    expect(isRetriableError(new Error('OpenRouter error 429: rate limited'))).toBe(true);
    expect(isRetriableError(new Error('OpenRouter stream error 503: unavailable'))).toBe(true);
  });

  it('returns false for generic errors', () => {
    expect(isRetriableError(new Error('invalid json'))).toBe(false);
  });

  it('returns true for TypeError (network failure)', () => {
    expect(isRetriableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('returns false for non-error values', () => {
    expect(isRetriableError(null)).toBe(false);
    expect(isRetriableError('string error')).toBe(false);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry()', () => {
  it('returns the response on first success', async () => {
    const inner = mockProvider(['hello']);
    const provider = withRetry(inner, { baseDelayMs: 0 });
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('hello');
    expect(inner.calls).toHaveLength(1);
  });

  it('retries on a retriable error and succeeds', async () => {
    const inner = succeedAfter([{ status: 429 }]);
    const provider = withRetry(inner, { maxAttempts: 3, baseDelayMs: 0 });
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('ok');
  });

  it('throws immediately on a non-retriable error', async () => {
    let calls = 0;
    const inner: AIProvider = {
      async chat() {
        calls++;
        throw { status: 401 };
      },
      async *stream() {},
    };
    const provider = withRetry(inner, { baseDelayMs: 0 });
    await expect(provider.chat(makeRequest())).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
  });

  it('exhausts maxAttempts and re-throws', async () => {
    const err = { status: 503 };
    const provider = withRetry(failingProvider(err), { maxAttempts: 3, baseDelayMs: 0 });
    await expect(provider.chat(makeRequest())).rejects.toMatchObject(err);
  });

  it('respects custom shouldRetry predicate', async () => {
    let calls = 0;
    const inner: AIProvider = {
      async chat() {
        calls++;
        throw new Error('custom error');
      },
      async *stream() {},
    };
    const provider = withRetry(inner, {
      maxAttempts: 3,
      baseDelayMs: 0,
      shouldRetry: (err) => err instanceof Error && err.message === 'custom error',
    });
    await expect(provider.chat(makeRequest())).rejects.toThrow('custom error');
    expect(calls).toBe(3); // retried all attempts
  });

  it('retries the correct number of times', async () => {
    let calls = 0;
    const inner: AIProvider = {
      async chat() {
        calls++;
        throw { status: 503 };
      },
      async *stream() {},
    };
    const provider = withRetry(inner, { maxAttempts: 4, baseDelayMs: 0 });
    await expect(provider.chat(makeRequest())).rejects.toBeDefined();
    expect(calls).toBe(4);
  });
});

// ─── withFallback ─────────────────────────────────────────────────────────────

describe('withFallback()', () => {
  it('throws when no providers given', () => {
    expect(() => withFallback()).toThrow('withFallback requires at least one provider');
  });

  it('returns the first provider response when it succeeds', async () => {
    const p1 = mockProvider(['primary']);
    const p2 = mockProvider(['secondary']);
    const provider = withFallback(p1, p2);
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('primary');
    expect(p1.calls).toHaveLength(1);
    expect(p2.calls).toHaveLength(0);
  });

  it('falls back to the second provider on failure', async () => {
    const p1 = failingProvider(new Error('rate limit'));
    const p2 = mockProvider(['fallback response']);
    const provider = withFallback(p1, p2);
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('fallback response');
  });

  it('tries all providers and re-throws the last error', async () => {
    const err = new Error('all failed');
    const provider = withFallback(failingProvider(new Error('p1')), failingProvider(err));
    await expect(provider.chat(makeRequest())).rejects.toBe(err);
  });

  it('works with a single provider', async () => {
    const p = mockProvider(['solo']);
    const provider = withFallback(p);
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('solo');
  });

  it('skips failed providers and uses the first successful one', async () => {
    const p1 = failingProvider(new Error('fail'));
    const p2 = failingProvider(new Error('fail'));
    const p3 = mockProvider(['third']);
    const provider = withFallback(p1, p2, p3);
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('third');
  });
});

// ─── Composition ──────────────────────────────────────────────────────────────

describe('withRetry + withFallback composition', () => {
  it('retries primary then falls back if all retries fail', async () => {
    let p1Calls = 0;
    const p1: AIProvider = {
      async chat() {
        p1Calls++;
        throw { status: 503 };
      },
      async *stream() {},
    };
    const p2 = mockProvider(['fallback ok']);

    const provider = withRetry(withFallback(p1, p2), { maxAttempts: 2, baseDelayMs: 0 });

    // withRetry wraps the fallback chain, so on each attempt it tries p1 then p2.
    // Attempt 1: p1 fails → p2 succeeds → done (no retry needed)
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('fallback ok');
    expect(p1Calls).toBe(1);
  });

  it('withFallback with per-provider withRetry retries each provider independently', async () => {
    let p1Calls = 0;
    const p1: AIProvider = {
      async chat() {
        p1Calls++;
        throw { status: 429 };
      },
      async *stream() {},
    };
    const p2 = mockProvider(['secondary ok']);

    const provider = withFallback(withRetry(p1, { maxAttempts: 2, baseDelayMs: 0 }), p2);

    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('secondary ok');
    expect(p1Calls).toBe(2); // retried once before falling back
  });
});
