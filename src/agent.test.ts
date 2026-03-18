import { describe, it, expect } from 'vitest';
import { agent, configure, runAgent } from './agent.js';
import type { AIProvider, ChatRequest, ChatResponse } from './types.js';
import { defineTool } from './tool.js';

// ─── Mock provider ────────────────────────────────────────────────────────────

function mockProvider(responses: Partial<ChatResponse>[]): AIProvider {
  let call = 0;
  return {
    async chat(): Promise<ChatResponse> {
      const response = responses[call++] ?? responses[responses.length - 1]!;
      return {
        id: 'mock-id',
        content: [{ type: 'text', text: 'default' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
        ...response,
      };
    },
    async *stream(): AsyncGenerator<never> {
      // no-op
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agent().prompt()', () => {
  it('returns text from a simple completion', async () => {
    const provider = mockProvider([
      { content: [{ type: 'text', text: 'Hello, world!' }], stopReason: 'end_turn' },
    ]);

    const response = await agent({
      instructions: 'Be helpful.',
      provider,
    }).prompt('Hi');

    expect(response.text).toBe('Hello, world!');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
  });

  it('executes tool calls in the agentic loop', async () => {
    const calculator = defineTool({
      name: 'calculator',
      description: 'Add two numbers',
      schema: (s) => ({
        a: s.integer().required(),
        b: s.integer().required(),
      }),
      handle: (input) => String((input['a'] as number) + (input['b'] as number)),
    });

    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tc_1', name: 'calculator', input: { a: 3, b: 4 } }],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'The answer is 7.' }],
        stopReason: 'end_turn',
      },
    ]);

    const response = await agent({
      instructions: 'Use tools to answer.',
      tools: [calculator],
      provider,
    }).prompt('What is 3 + 4?');

    expect(response.text).toBe('The answer is 7.');
    // Usage should be accumulated across iterations
    expect(response.usage.inputTokens).toBe(20);
    expect(response.usage.outputTokens).toBe(10);
  });

  it('parses structured output from JSON response', async () => {
    const provider = mockProvider([
      {
        content: [{ type: 'text', text: JSON.stringify({ score: 8, approved: true }) }],
        stopReason: 'end_turn',
      },
    ]);

    const response = await agent({
      instructions: 'Evaluate quality.',
      schema: (s) => ({
        score: s.integer().min(1).max(10).required(),
        approved: s.boolean().required(),
      }),
      provider,
    }).prompt<{ score: number; approved: boolean }>('Rate this content.');

    expect(response.structured).toEqual({ score: 8, approved: true });
  });

  it('handles tool not found gracefully', async () => {
    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tc_1', name: 'unknown_tool', input: {} }],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'I could not use that tool.' }],
        stopReason: 'end_turn',
      },
    ]);

    const response = await agent({ instructions: 'Test.', provider }).prompt('Do something');
    expect(response.text).toBe('I could not use that tool.');
  });

  it('throws when maxIterations is exceeded', async () => {
    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tc_1', name: 'loop', input: {} }],
        stopReason: 'tool_use',
      },
    ]);

    await expect(
      agent({
        instructions: 'Loop forever.',
        provider,
        maxIterations: 2,
      }).prompt('Go'),
    ).rejects.toThrow('maxIterations');
  });

  it('throws when no provider is configured', async () => {
    // Reset global provider by configuring null-ish — actually just test error message
    await expect(
      agent({ instructions: 'No provider.' }).prompt('Hi'),
    ).rejects.toThrow('No AI provider configured');
  });
});

describe('configure()', () => {
  it('sets global provider and model', async () => {
    let capturedRequest: ChatRequest | undefined;
    const provider: AIProvider = {
      async chat(req): Promise<ChatResponse> {
        capturedRequest = req;
        return {
          id: 'x',
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      async *stream(): AsyncGenerator<never> {},
    };

    configure({ provider, model: 'my/model' });

    await agent({ instructions: 'Test.' }).prompt('Hello');
    expect(capturedRequest?.model).toBe('my/model');

    // Reset to avoid polluting other tests
    configure({ provider: undefined as unknown as AIProvider });
  });
});

describe('runAgent()', () => {
  it('works with class-based agent', async () => {
    const provider = mockProvider([
      { content: [{ type: 'text', text: 'Class-based works!' }], stopReason: 'end_turn' },
    ]);

    const response = await runAgent(
      { instructions: () => 'You are a test agent.' },
      'Hello',
      { provider },
    );

    expect(response.text).toBe('Class-based works!');
  });
});
