import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agent } from './agent.js';
import { assertComplete } from './checkpoint.js';
import { defineTool } from './tool.js';
import type { AIProvider, ChatResponse } from './types.js';
import { isZodSchema } from './zod.js';

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
    async *stream(): AsyncGenerator<never> {},
  };
}

// ─── isZodSchema ──────────────────────────────────────────────────────────────

describe('isZodSchema()', () => {
  it('detects Zod schemas', () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.object({ name: z.string() }))).toBe(true);
    expect(isZodSchema(z.array(z.number()))).toBe(true);
  });

  it('rejects non-Zod values', () => {
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema('string')).toBe(false);
    expect(isZodSchema((s: unknown) => s)).toBe(false);
    expect(isZodSchema({ type: 'object' })).toBe(false);
  });
});

// ─── defineTool with Zod schema ───────────────────────────────────────────────

describe('defineTool() with Zod schema', () => {
  it('accepts a Zod schema and converts to JSON Schema', async () => {
    const InputSchema = z.object({
      a: z.number(),
      b: z.number(),
    });

    const calculator = defineTool({
      name: 'calculator',
      description: 'Add two numbers',
      schema: InputSchema,
      handle: (input) => String((input.a as number) + (input.b as number)),
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

    const response = assertComplete(
      await agent({ instructions: 'Use tools to answer.', tools: [calculator], provider }).prompt(
        '3 + 4?',
      ),
    );

    expect(response.text).toBe('The answer is 7.');
  });
});

// ─── agent() with Zod schema ──────────────────────────────────────────────────

describe('agent() with Zod schema', () => {
  it('parses structured output using safeParse', async () => {
    const OutputSchema = z.object({
      score: z.number().int().min(1).max(10),
      approved: z.boolean(),
    });

    const provider = mockProvider([
      {
        content: [{ type: 'text', text: JSON.stringify({ score: 8, approved: true }) }],
        stopReason: 'end_turn',
      },
    ]);

    const response = assertComplete(
      await agent({
        instructions: 'Evaluate quality.',
        schema: OutputSchema,
        provider,
      }).prompt<z.infer<typeof OutputSchema>>('Rate this content.'),
    );

    expect(response.structured.score).toBe(8);
    expect(response.structured.approved).toBe(true);
  });

  it('falls back to raw JSON when Zod validation fails', async () => {
    const OutputSchema = z.object({ score: z.number() });

    const provider = mockProvider([
      {
        content: [{ type: 'text', text: JSON.stringify({ score: 'not-a-number' }) }],
        stopReason: 'end_turn',
      },
    ]);

    const response = assertComplete(
      await agent({ instructions: 'Test.', schema: OutputSchema, provider }).prompt('Go'),
    );

    // safeParse fails → falls back to raw parsed JSON
    expect((response.structured as Record<string, unknown>).score).toBe('not-a-number');
  });

  it('accepts a Zod schema alongside the fluent builder — both work', async () => {
    const ZodSchema = z.object({ value: z.string() });

    const providerZod = mockProvider([
      {
        content: [{ type: 'text', text: JSON.stringify({ value: 'hello' }) }],
        stopReason: 'end_turn',
      },
    ]);
    const providerFluent = mockProvider([
      {
        content: [{ type: 'text', text: JSON.stringify({ value: 'hello' }) }],
        stopReason: 'end_turn',
      },
    ]);

    const [zodResult, fluentResult] = await Promise.all([
      assertComplete(
        await agent({ instructions: 'Test.', schema: ZodSchema, provider: providerZod }).prompt(
          'Go',
        ),
      ),
      assertComplete(
        await agent({
          instructions: 'Test.',
          schema: (s) => ({ value: s.string().required() }),
          provider: providerFluent,
        }).prompt('Go'),
      ),
    ]);

    expect((zodResult.structured as Record<string, unknown>).value).toBe('hello');
    expect((fluentResult.structured as Record<string, unknown>).value).toBe('hello');
  });
});
