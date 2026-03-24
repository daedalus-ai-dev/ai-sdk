import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vercelAI } from './vercel.js';

// ─── Mock Vercel AI SDK ────────────────────────────────────────────────────────

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
  jsonSchema: (schema: unknown) => ({ __schema: schema }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_MODEL = { __brand: 'LanguageModel' } as never;

const BASE_REQUEST = {
  model: 'ignored-in-vercel-provider',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

// ─── chat() ───────────────────────────────────────────────────────────────────

describe('vercelAI — chat()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns text response', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Hello back',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      response: { id: 'resp-1' },
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const result = await provider.chat(BASE_REQUEST);

    expect(result.content).toEqual([{ type: 'text', text: 'Hello back' }]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.id).toBe('resp-1');
  });

  it('maps tool-calls finish reason to tool_use stop reason', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'my_tool', input: { x: 1 } }],
      finishReason: 'tool-calls',
      usage: { inputTokens: 20, outputTokens: 8 },
      response: { id: 'resp-2' },
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const result = await provider.chat(BASE_REQUEST);

    expect(result.stopReason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'tc-1', name: 'my_tool', input: { x: 1 } },
    ]);
  });

  it('passes system prompt and tools to generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 },
      response: { id: 'r' },
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    await provider.chat({
      ...BASE_REQUEST,
      systemPrompt: 'Be helpful',
      tools: [
        {
          name: 'calc',
          description: 'Adds numbers',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Be helpful',
        tools: { calc: expect.objectContaining({ description: 'Adds numbers' }) },
      }),
    );
  });

  it('converts tool_result messages to tool role messages', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'done',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 },
      response: { id: 'r' },
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    await provider.chat({
      model: 'x',
      messages: [
        { role: 'user', content: 'use tool' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tc-1', name: 'my_tool', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'tc-1', content: 'result text' }],
        },
      ],
    });

    const passedMessages = mockGenerateText.mock.calls[0]?.[0]?.messages as Array<{
      role: string;
      content: Array<{ toolName: string }>;
    }>;
    const toolMsg = passedMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content[0]?.toolName).toBe('my_tool');
  });
});

// ─── stream() ─────────────────────────────────────────────────────────────────

describe('vercelAI — stream()', () => {
  beforeEach(() => vi.clearAllMocks());

  async function* makeStream(parts: Array<Record<string, unknown>>) {
    for (const p of parts) yield p;
  }

  it('yields text chunks', async () => {
    mockStreamText.mockReturnValue({
      fullStream: makeStream([
        { type: 'text-delta', text: 'Hi ' },
        { type: 'text-delta', text: 'there' },
        { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 3 } },
      ]),
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const chunks = [];
    for await (const chunk of provider.stream(BASE_REQUEST)) chunks.push(chunk);

    expect(chunks.filter((c) => c.type === 'text')).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'text', text: 'there' },
    ]);
  });

  it('yields tool_use events from tool-input-* chunks', async () => {
    mockStreamText.mockReturnValue({
      fullStream: makeStream([
        { type: 'tool-input-start', id: 'tc-1', toolName: 'calc' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '{"a":' },
        { type: 'tool-input-delta', id: 'tc-1', delta: '1}' },
        { type: 'tool-input-end', id: 'tc-1' },
        {
          type: 'finish-step',
          finishReason: 'tool-calls',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const chunks = [];
    for await (const chunk of provider.stream(BASE_REQUEST)) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: 'tool_use_start', toolUseId: 'tc-1', toolName: 'calc' });
    expect(chunks[1]).toEqual({
      type: 'tool_use_delta',
      toolUseId: 'tc-1',
      toolInputDelta: '{"a":',
    });
    expect(chunks[2]).toEqual({ type: 'tool_use_delta', toolUseId: 'tc-1', toolInputDelta: '1}' });
    expect(chunks[3]).toEqual({ type: 'tool_use_end', toolUseId: 'tc-1' });
  });

  it('does not double-emit tool-call chunk when tool-input-* already seen', async () => {
    mockStreamText.mockReturnValue({
      fullStream: makeStream([
        { type: 'tool-input-start', id: 'tc-1', toolName: 'calc' },
        { type: 'tool-input-end', id: 'tc-1' },
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'calc', input: { a: 1 } },
        {
          type: 'finish-step',
          finishReason: 'tool-calls',
          usage: { inputTokens: 5, outputTokens: 2 },
        },
      ]),
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const chunks = [];
    for await (const chunk of provider.stream(BASE_REQUEST)) chunks.push(chunk);

    const startEvents = chunks.filter((c) => c.type === 'tool_use_start');
    expect(startEvents).toHaveLength(1); // not duplicated
  });

  it('emits message_end with usage from finish-step', async () => {
    mockStreamText.mockReturnValue({
      fullStream: makeStream([
        { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 7 } },
      ]),
    });

    const provider = vercelAI({ model: FAKE_MODEL });
    const chunks = [];
    for await (const chunk of provider.stream(BASE_REQUEST)) chunks.push(chunk);

    expect(chunks[0]).toEqual({
      type: 'message_end',
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 7 },
    });
  });
});
