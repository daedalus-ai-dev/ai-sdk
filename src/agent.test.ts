import { describe, it, expect } from 'vitest';
import { agent, configure, runAgent } from './agent.js';
import type { AIProvider, ChatRequest, ChatResponse } from './types.js';
import { defineTool } from './tool.js';
import { assertComplete, InterruptError, isInterrupted } from './checkpoint.js';

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

    const response = assertComplete(await agent({
      instructions: 'Be helpful.',
      provider,
    }).prompt('Hi'));

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

    const response = assertComplete(await agent({
      instructions: 'Use tools to answer.',
      tools: [calculator],
      provider,
    }).prompt('What is 3 + 4?'));

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

    const response = assertComplete(await agent({
      instructions: 'Evaluate quality.',
      schema: (s) => ({
        score: s.integer().min(1).max(10).required(),
        approved: s.boolean().required(),
      }),
      provider,
    }).prompt<{ score: number; approved: boolean }>('Rate this content.'));

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

    const response = assertComplete(await agent({ instructions: 'Test.', provider }).prompt('Do something'));
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

describe('checkpointing', () => {
  it('includes a checkpoint in the normal response', async () => {
    const provider = mockProvider([
      { content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
    ]);

    const result = assertComplete(await agent({ instructions: 'Test.', provider }).prompt('Go'));
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint.messages).toHaveLength(2); // user + assistant
    expect(result.checkpoint.iterations).toBe(1);
    expect(result.checkpoint.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.checkpoint.pendingToolUseId).toBeUndefined();
  });

  it('returns an InterruptedResponse when a tool throws InterruptError', async () => {
    const askUser = defineTool({
      name: 'ask_user',
      description: 'Ask the user a question',
      schema: (s) => ({ question: s.string().required() }),
      handle: ({ question }) => { throw new InterruptError(question as string); },
    });

    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'ask_user', input: { question: 'What is your name?' } }],
        stopReason: 'tool_use',
      },
    ]);

    const result = await agent({ instructions: 'Ask the user.', tools: [askUser], provider }).prompt('Start');

    expect(isInterrupted(result)).toBe(true);
    if (isInterrupted(result)) {
      expect(result.question).toBe('What is your name?');
      expect(result.checkpoint.pendingToolUseId).toBe('tu_1');
      expect(result.checkpoint.iterations).toBe(1);
    }
  });

  it('resumes from a checkpoint and continues the loop', async () => {
    const askUser = defineTool({
      name: 'ask_user',
      description: 'Ask the user a question',
      schema: (s) => ({ question: s.string().required() }),
      handle: ({ question }) => { throw new InterruptError(question as string); },
    });

    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'ask_user', input: { question: 'Your name?' } }],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'Hello, Alice!' }],
        stopReason: 'end_turn',
      },
    ]);

    const runner = agent({ instructions: 'Ask the user.', tools: [askUser], provider });

    const first = await runner.prompt('Start');
    expect(isInterrupted(first)).toBe(true);

    if (isInterrupted(first)) {
      const resumed = assertComplete(await runner.resume(first.checkpoint, 'Alice'));
      expect(resumed.text).toBe('Hello, Alice!');
      // iterations continues from where it left off
      expect(resumed.checkpoint.iterations).toBe(2);
    }
  });

  it('assertComplete throws when result is interrupted', async () => {
    const askUser = defineTool({
      name: 'ask_user',
      description: 'Ask the user a question',
      schema: (s) => ({ question: s.string().required() }),
      handle: () => { throw new InterruptError('What?'); },
    });

    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'ask_user', input: { question: 'What?' } }],
        stopReason: 'tool_use',
      },
    ]);

    const result = await agent({ instructions: 'Test.', tools: [askUser], provider }).prompt('Go');
    expect(() => assertComplete(result)).toThrow('Agent interrupted: What?');
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

    const response = assertComplete(await runAgent(
      { instructions: () => 'You are a test agent.' },
      'Hello',
      { provider },
    ));

    expect(response.text).toBe('Class-based works!');
  });
});
