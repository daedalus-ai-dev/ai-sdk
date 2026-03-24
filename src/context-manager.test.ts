import { describe, expect, it, vi } from 'vitest';
import { slidingWindow, summarizing, tokenBudget } from './context-manager.js';
import type { AIProvider, Message } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userMsg(text: string): Message {
  return { role: 'user', content: text };
}

function assistantMsg(text: string): Message {
  return { role: 'assistant', content: text };
}

function toolUseMsg(id: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'my_tool', input: {} }],
  };
}

function toolResultMsg(id: string): Message {
  return {
    role: 'user',
    content: [{ type: 'tool_result', toolUseId: id, content: 'result' }],
  };
}

// ─── slidingWindow ────────────────────────────────────────────────────────────

describe('slidingWindow', () => {
  it('returns all messages when under the limit', () => {
    const msgs = [userMsg('a'), assistantMsg('b'), userMsg('c')];
    expect(slidingWindow(10).manage(msgs)).toEqual(msgs);
  });

  it('trims to the last N messages', () => {
    const msgs = [userMsg('1'), assistantMsg('2'), userMsg('3'), assistantMsg('4'), userMsg('5')];
    expect(slidingWindow(3).manage(msgs)).toEqual(msgs.slice(-3));
  });

  it('drops orphaned tool_result at the start after trimming', () => {
    const msgs = [
      userMsg('task'),
      toolUseMsg('id1'),
      toolResultMsg('id1'),
      assistantMsg('done'),
      userMsg('follow-up'),
    ];
    // maxMessages=3 would keep [toolResultMsg, assistantMsg, userMsg]
    // toolResultMsg is orphaned (its tool_use was cut) — should be dropped
    const result = slidingWindow(3).manage(msgs) as Message[];
    expect(result[0]).not.toMatchObject({
      role: 'user',
      content: expect.arrayContaining([expect.objectContaining({ type: 'tool_result' })]),
    });
  });

  it('returns all messages when equal to the limit', () => {
    const msgs = [userMsg('a'), assistantMsg('b')];
    expect(slidingWindow(2).manage(msgs)).toEqual(msgs);
  });
});

// ─── tokenBudget ──────────────────────────────────────────────────────────────

describe('tokenBudget', () => {
  it('returns all messages when under budget', () => {
    const msgs = [userMsg('hi'), assistantMsg('hello')];
    // "hi" ≈ 1 token, "hello" ≈ 2 tokens — well under 1000
    expect(tokenBudget(1000).manage(msgs)).toEqual(msgs);
  });

  it('drops oldest messages to fit under budget', () => {
    // Each message ~250 tokens (1000 chars / 4)
    const long = 'x'.repeat(1000);
    const msgs = [userMsg(long), assistantMsg(long), userMsg(long), assistantMsg(long)];
    const result = tokenBudget(300).manage(msgs) as Message[];
    expect(result.length).toBeLessThan(msgs.length);
  });

  it('keeps at least the last message', () => {
    const long = 'x'.repeat(10000);
    const msgs = [userMsg(long), assistantMsg(long)];
    // Even if the single last message exceeds the budget, keep it
    const result = tokenBudget(1).manage(msgs) as Message[];
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('drops orphaned tool_result at the start', () => {
    const long = 'x'.repeat(1000);
    const msgs = [toolUseMsg('id1'), toolResultMsg('id1'), userMsg(long), assistantMsg(long)];
    const result = tokenBudget(300).manage(msgs) as Message[];
    expect(result[0]).not.toMatchObject({
      role: 'user',
      content: expect.arrayContaining([expect.objectContaining({ type: 'tool_result' })]),
    });
  });
});

// ─── summarizing ──────────────────────────────────────────────────────────────

describe('summarizing', () => {
  function makeProvider(summaryText: string): AIProvider {
    return {
      chat: vi.fn().mockResolvedValue({
        id: 'test',
        content: [{ type: 'text', text: summaryText }],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
      stream: vi.fn() as AIProvider['stream'],
    };
  }

  it('returns messages unchanged when within keepRecent', async () => {
    const provider = makeProvider('summary');
    const msgs = [userMsg('a'), assistantMsg('b')];
    const result = await summarizing({ provider, model: 'test', keepRecent: 10 }).manage(msgs);
    expect(result).toEqual(msgs);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('summarizes old messages and keeps recent ones', async () => {
    const provider = makeProvider('This is the summary.');
    const msgs = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? userMsg(`user ${i}`) : assistantMsg(`assistant ${i}`),
    );
    const result = await summarizing({ provider, model: 'test', keepRecent: 4 }).manage(msgs);

    // Summary message + 4 recent
    expect(result).toHaveLength(5);
    expect(result[0].content).toContain('This is the summary.');
    expect(result.slice(1)).toEqual(msgs.slice(-4));
  });

  it('uses custom summaryPrompt when provided', async () => {
    const provider = makeProvider('custom summary');
    const msgs = Array.from({ length: 6 }, (_, i) => userMsg(`msg ${i}`));
    await summarizing({
      provider,
      model: 'test',
      keepRecent: 2,
      summaryPrompt: 'Custom prompt:',
    }).manage(msgs);

    const callArg = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      messages: Message[];
    };
    expect(callArg.messages[0]?.content as string).toContain('Custom prompt:');
  });

  it('uses default keepRecent of 10', async () => {
    const provider = makeProvider('summary');
    const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
    const result = await summarizing({ provider, model: 'test' }).manage(msgs);
    // 1 summary + 10 recent
    expect(result).toHaveLength(11);
  });
});
