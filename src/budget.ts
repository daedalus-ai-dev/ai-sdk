import type { AIProvider, ChatRequest, ChatResponse, StreamChunk, Usage } from './types.js';

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown by {@link withTokenBudget} when cumulative token usage exceeds the
 * configured limit.
 */
export class TokenBudgetExceededError extends Error {
  constructor(
    public readonly used: Usage,
    public readonly limit: {
      maxTotalTokens?: number;
      maxInputTokens?: number;
      maxOutputTokens?: number;
    },
  ) {
    const parts: string[] = [];
    if (limit.maxTotalTokens !== undefined)
      parts.push(`total ${used.inputTokens + used.outputTokens}/${limit.maxTotalTokens}`);
    if (limit.maxInputTokens !== undefined)
      parts.push(`input ${used.inputTokens}/${limit.maxInputTokens}`);
    if (limit.maxOutputTokens !== undefined)
      parts.push(`output ${used.outputTokens}/${limit.maxOutputTokens}`);
    super(`Token budget exceeded: ${parts.join(', ')}`);
    this.name = 'TokenBudgetExceededError';
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface TokenBudgetOptions {
  /** Abort when `inputTokens + outputTokens` exceeds this value. */
  maxTotalTokens?: number;
  /** Abort when `inputTokens` exceeds this value. */
  maxInputTokens?: number;
  /** Abort when `outputTokens` exceeds this value. */
  maxOutputTokens?: number;
}

// ─── withTokenBudget ──────────────────────────────────────────────────────────

/**
 * Wrap a provider with a cumulative token budget. After each response the
 * accumulated usage is checked against the limits; if any limit is exceeded a
 * {@link TokenBudgetExceededError} is thrown, aborting the current agent loop.
 *
 * The counter is **per-wrapper-instance**, so you can scope budgets to a
 * single `refine()` loop or a whole workflow by sharing or isolating the
 * wrapped provider.
 *
 * ```ts
 * const provider = withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 50_000 });
 *
 * // Use the provider in any agent, skill, or workflow
 * const result = await agent({ instructions: '...', provider }).prompt('hello');
 * ```
 *
 * Combine with {@link withRetry} by wrapping the budget provider:
 *
 * ```ts
 * const provider = withRetry(
 *   withTokenBudget(openai('gpt-4o'), { maxTotalTokens: 20_000 }),
 *   { maxAttempts: 2 },
 * );
 * ```
 */
export function withTokenBudget(provider: AIProvider, options: TokenBudgetOptions): AIProvider {
  if (
    options.maxTotalTokens === undefined &&
    options.maxInputTokens === undefined &&
    options.maxOutputTokens === undefined
  ) {
    throw new Error('withTokenBudget: at least one limit must be specified');
  }

  const used: Usage = { inputTokens: 0, outputTokens: 0 };

  function check(): void {
    const exceeded =
      (options.maxTotalTokens !== undefined &&
        used.inputTokens + used.outputTokens > options.maxTotalTokens) ||
      (options.maxInputTokens !== undefined && used.inputTokens > options.maxInputTokens) ||
      (options.maxOutputTokens !== undefined && used.outputTokens > options.maxOutputTokens);

    if (exceeded) throw new TokenBudgetExceededError(used, options);
  }

  function accumulate(usage: Usage): void {
    used.inputTokens += usage.inputTokens;
    used.outputTokens += usage.outputTokens;
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const response = await provider.chat(request);
      accumulate(response.usage);
      check();
      return response;
    },

    async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === 'message_end' && chunk.usage) {
          accumulate(chunk.usage);
          check();
        }
        yield chunk;
      }
    },

    /** Current cumulative usage tracked by this budget wrapper. */
    get usage(): Readonly<Usage> {
      return { ...used };
    },
  } as AIProvider & { usage: Readonly<Usage> };
}
