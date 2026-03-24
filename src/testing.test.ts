import { describe, expect, it } from 'vitest';
import { agent } from './agent.js';
import { assertComplete } from './checkpoint.js';
import { mockProvider, mockTool, toolUseResponse } from './testing.js';

// ─── mockProvider ─────────────────────────────────────────────────────────────

describe('mockProvider()', () => {
  it('returns text from a string shorthand', async () => {
    const provider = mockProvider(['Hello!']);
    const result = await provider.chat({
      model: 'test',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(result.stopReason).toBe('end_turn');
  });

  it('sequences responses in order', async () => {
    const provider = mockProvider(['First', 'Second', 'Third']);
    const req = { model: 'test', messages: [{ role: 'user' as const, content: 'x' }] };

    const r1 = await provider.chat(req);
    const r2 = await provider.chat(req);
    const r3 = await provider.chat(req);

    expect((r1.content[0] as { text: string }).text).toBe('First');
    expect((r2.content[0] as { text: string }).text).toBe('Second');
    expect((r3.content[0] as { text: string }).text).toBe('Third');
  });

  it('repeats the last response when exhausted', async () => {
    const provider = mockProvider(['Only']);
    const req = { model: 'test', messages: [{ role: 'user' as const, content: 'x' }] };

    await provider.chat(req);
    const r2 = await provider.chat(req);

    expect((r2.content[0] as { text: string }).text).toBe('Only');
  });

  it('records all requests in .calls', async () => {
    const provider = mockProvider(['ok']);
    const req = { model: 'test', messages: [{ role: 'user' as const, content: 'ping' }] };

    await provider.chat(req);
    await provider.chat(req);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toBe(req);
  });

  it('accepts a partial ChatResponse with custom usage', async () => {
    const provider = mockProvider([
      { content: [{ type: 'text', text: 'hi' }], usage: { inputTokens: 100, outputTokens: 50 } },
    ]);
    const result = await provider.chat({
      model: 'test',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('accepts a string content shorthand inside partial response', async () => {
    const provider = mockProvider([{ content: 'shorthand text', stopReason: 'end_turn' }]);
    const result = await provider.chat({
      model: 'test',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'shorthand text' }]);
  });
});

// ─── toolUseResponse ──────────────────────────────────────────────────────────

describe('toolUseResponse()', () => {
  it('builds a tool_use ChatResponse', async () => {
    const provider = mockProvider([toolUseResponse('search', { query: 'TypeScript' }), 'Done.']);
    const r1 = await provider.chat({ model: 'test', messages: [] });
    expect(r1.stopReason).toBe('tool_use');
    expect(r1.content[0]).toMatchObject({
      type: 'tool_use',
      name: 'search',
      input: { query: 'TypeScript' },
    });
  });

  it('uses a custom id when provided', async () => {
    const provider = mockProvider([toolUseResponse('fn', {}, { id: 'my-id' })]);
    const r = await provider.chat({ model: 'test', messages: [] });
    expect((r.content[0] as { id: string }).id).toBe('my-id');
  });
});

// ─── mockTool ─────────────────────────────────────────────────────────────────

describe('mockTool()', () => {
  it('returns a fixed string', async () => {
    const tool = mockTool('lookup', 'static result');
    expect(await tool.handle({})).toBe('static result');
  });

  it('calls a dynamic handler with the input', async () => {
    const tool = mockTool('echo', ({ msg }) => `echo: ${msg}`);
    expect(await tool.handle({ msg: 'hello' })).toBe('echo: hello');
  });

  it('records calls', async () => {
    const tool = mockTool('fn', 'ok');
    await tool.handle({ a: 1 });
    await tool.handle({ a: 2 });
    expect(tool.calls).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('exposes name and description', () => {
    const tool = mockTool('my_tool', 'result');
    expect(tool.name()).toBe('my_tool');
    expect(tool.description()).toBe('Mock tool: my_tool');
  });

  it('exposes an empty schema', () => {
    const tool = mockTool('t', 'x');
    expect(tool.schema({} as never)).toEqual({});
  });
});

// ─── Integration: agent() with mockProvider + mockTool ───────────────────────

describe('integration', () => {
  it('runs agent with a simple text response', async () => {
    const provider = mockProvider(['The sky is blue.']);
    const result = assertComplete(
      await agent({ instructions: 'Be helpful.', provider }).prompt('What colour is the sky?'),
    );
    expect(result.text).toBe('The sky is blue.');
    expect(provider.calls).toHaveLength(1);
  });

  it('executes a tool call and returns the final response', async () => {
    const calculator = mockTool('add', ({ a, b }) => String(Number(a) + Number(b)));

    const provider = mockProvider([toolUseResponse('add', { a: 3, b: 4 }), 'The answer is 7.']);

    const result = assertComplete(
      await agent({ instructions: 'Use the calculator.', tools: [calculator], provider }).prompt(
        'What is 3 + 4?',
      ),
    );

    expect(result.text).toBe('The answer is 7.');
    expect(calculator.calls).toHaveLength(1);
    expect(calculator.calls[0]).toEqual({ a: 3, b: 4 });
    expect(provider.calls).toHaveLength(2); // tool_use call + follow-up
  });

  it('tracks token usage across multiple iterations', async () => {
    const provider = mockProvider([
      toolUseResponse('fn', {}, { usage: { inputTokens: 20, outputTokens: 5 } }),
      { content: 'Done.', usage: { inputTokens: 15, outputTokens: 8 } },
    ]);

    const tool = mockTool('fn', 'result');

    const result = assertComplete(
      await agent({ instructions: '...', tools: [tool], provider }).prompt('go'),
    );

    expect(result.usage.inputTokens).toBe(35);
    expect(result.usage.outputTokens).toBe(13);
  });
});
