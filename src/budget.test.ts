import { describe, expect, it } from 'vitest';
import { TokenBudgetExceededError, withTokenBudget } from './budget.js';
import { mockProvider } from './testing.js';

function makeRequest() {
  return { model: 'test', messages: [{ role: 'user' as const, content: 'hi' }] };
}

describe('withTokenBudget()', () => {
  it('throws when no limit is specified', () => {
    expect(() => withTokenBudget(mockProvider(['ok']), {})).toThrow(
      'at least one limit must be specified',
    );
  });

  it('passes through a response that is within budget', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 100, outputTokens: 50 } }]);
    const provider = withTokenBudget(inner, { maxTotalTokens: 1000 });
    const result = await provider.chat(makeRequest());
    expect((result.content[0] as { text: string }).text).toBe('ok');
  });

  it('throws TokenBudgetExceededError when maxTotalTokens is exceeded', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 60, outputTokens: 50 } }]);
    const provider = withTokenBudget(inner, { maxTotalTokens: 100 });
    await expect(provider.chat(makeRequest())).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it('throws when maxInputTokens is exceeded', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 200, outputTokens: 10 } }]);
    const provider = withTokenBudget(inner, { maxInputTokens: 100 });
    await expect(provider.chat(makeRequest())).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it('throws when maxOutputTokens is exceeded', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 10, outputTokens: 200 } }]);
    const provider = withTokenBudget(inner, { maxOutputTokens: 100 });
    await expect(provider.chat(makeRequest())).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it('accumulates usage across multiple calls', async () => {
    const inner = mockProvider([
      { content: 'r1', usage: { inputTokens: 40, outputTokens: 40 } },
      { content: 'r2', usage: { inputTokens: 40, outputTokens: 40 } },
    ]);
    const provider = withTokenBudget(inner, { maxTotalTokens: 100 });

    await provider.chat(makeRequest()); // 80 total — ok
    await expect(provider.chat(makeRequest())).rejects.toBeInstanceOf(TokenBudgetExceededError); // 160 > 100
  });

  it('error message includes used and limit values', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 60, outputTokens: 60 } }]);
    const provider = withTokenBudget(inner, { maxTotalTokens: 100 });
    const error = await provider.chat(makeRequest()).catch((e) => e);
    expect(error).toBeInstanceOf(TokenBudgetExceededError);
    expect(error.message).toContain('120/100');
    expect(error.used).toEqual({ inputTokens: 60, outputTokens: 60 });
  });

  it('allows multiple limits simultaneously', async () => {
    // Under total limit but over output limit
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 10, outputTokens: 150 } }]);
    const provider = withTokenBudget(inner, {
      maxTotalTokens: 1000,
      maxOutputTokens: 100,
    });
    await expect(provider.chat(makeRequest())).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it('does not throw for a provider that uses exactly the budget', async () => {
    const inner = mockProvider([{ content: 'ok', usage: { inputTokens: 50, outputTokens: 50 } }]);
    const provider = withTokenBudget(inner, { maxTotalTokens: 100 });
    await expect(provider.chat(makeRequest())).resolves.toBeDefined();
  });
});

describe('TokenBudgetExceededError', () => {
  it('has the correct name', () => {
    const err = new TokenBudgetExceededError(
      { inputTokens: 60, outputTokens: 60 },
      { maxTotalTokens: 100 },
    );
    expect(err.name).toBe('TokenBudgetExceededError');
  });

  it('is an instance of Error', () => {
    const err = new TokenBudgetExceededError(
      { inputTokens: 60, outputTokens: 60 },
      { maxTotalTokens: 100 },
    );
    expect(err).toBeInstanceOf(Error);
  });
});
