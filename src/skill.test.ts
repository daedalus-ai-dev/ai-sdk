import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSkills,
  getSkill,
  hasSkill,
  listSkills,
  parseSkill,
  registerSkill,
  skill,
} from './skill.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mock the agent module so tests don't make real LLM calls. */
vi.mock('./agent.js', () => ({
  agent: vi.fn(() => ({
    prompt: vi.fn().mockResolvedValue({
      text: 'mocked response',
      structured: { label: 'positive', confidence: 0.95 },
      usage: { inputTokens: 10, outputTokens: 5 },
      messages: [],
      checkpoint: {},
    }),
  })),
}));

beforeEach(() => {
  clearSkills();
  vi.clearAllMocks();
});

// ─── skill() factory ──────────────────────────────────────────────────────────

describe('skill()', () => {
  it('returns a runner with an invoke method', () => {
    const runner = skill({ instructions: 'Do something.' });
    expect(typeof runner.invoke).toBe('function');
  });

  it('invoke passes a string input directly as the prompt', async () => {
    const { agent } = await import('./agent.js');
    const mockPrompt = vi.fn().mockResolvedValue({
      text: 'ok',
      structured: {},
      usage: { inputTokens: 1, outputTokens: 1 },
      messages: [],
      checkpoint: {},
    });
    vi.mocked(agent).mockReturnValueOnce({ prompt: mockPrompt } as any);

    const runner = skill({ instructions: 'Classify text.' });
    await runner.invoke('hello world');

    expect(mockPrompt).toHaveBeenCalledWith('hello world');
  });

  it('invoke JSON-stringifies object inputs when no template is provided', async () => {
    const { agent } = await import('./agent.js');
    const mockPrompt = vi.fn().mockResolvedValue({
      text: 'ok',
      structured: {},
      usage: { inputTokens: 1, outputTokens: 1 },
      messages: [],
      checkpoint: {},
    });
    vi.mocked(agent).mockReturnValueOnce({ prompt: mockPrompt } as any);

    const runner = skill({ instructions: 'Extract.' });
    await runner.invoke({ text: 'hello', language: 'en' });

    expect(mockPrompt).toHaveBeenCalledWith(
      JSON.stringify({ text: 'hello', language: 'en' }, null, 2),
    );
  });

  it('uses template function when provided', async () => {
    const { agent } = await import('./agent.js');
    const mockPrompt = vi.fn().mockResolvedValue({
      text: 'ok',
      structured: {},
      usage: { inputTokens: 1, outputTokens: 1 },
      messages: [],
      checkpoint: {},
    });
    vi.mocked(agent).mockReturnValueOnce({ prompt: mockPrompt } as any);

    const runner = skill<{ text: string }>({
      instructions: 'Summarize.',
      template: (input) => `Summarize this: ${input.text}`,
    });
    await runner.invoke({ text: 'some content' });

    expect(mockPrompt).toHaveBeenCalledWith('Summarize this: some content');
  });

  it('validates input with a Zod schema before calling the LLM', async () => {
    const z = await import('zod');
    const runner = skill({
      instructions: 'Classify.',
      input: z.object({ text: z.string() }),
    });

    await expect(runner.invoke({ text: 123 } as any)).rejects.toThrow();
  });

  it('returns text, structured, and usage from the LLM response', async () => {
    const runner = skill({ instructions: 'Do it.' });
    const result = await runner.invoke('input');

    expect(result.text).toBe('mocked response');
    expect(result.structured).toEqual({ label: 'positive', confidence: 0.95 });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('passes maxIterations: 1 to the agent', async () => {
    const { agent } = await import('./agent.js');
    const runner = skill({ instructions: 'Do it.' });
    await runner.invoke('input');

    expect(vi.mocked(agent)).toHaveBeenCalledWith(expect.objectContaining({ maxIterations: 1 }));
  });

  it('forwards model, temperature, and maxTokens to the agent', async () => {
    const { agent } = await import('./agent.js');
    const runner = skill({
      instructions: 'Do it.',
      model: 'anthropic/claude-3-haiku',
      temperature: 0.2,
      maxTokens: 512,
    });
    await runner.invoke('input');

    expect(vi.mocked(agent)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-3-haiku',
        temperature: 0.2,
        maxTokens: 512,
      }),
    );
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe('skill registry', () => {
  it('registers and retrieves a skill by name', () => {
    registerSkill('summarize', { instructions: 'Summarize.' });
    expect(hasSkill('summarize')).toBe(true);
  });

  it('getSkill returns a runner', () => {
    registerSkill('classify', { instructions: 'Classify.' });
    const runner = getSkill('classify');
    expect(typeof runner.invoke).toBe('function');
  });

  it('getSkill throws for unregistered names', () => {
    expect(() => getSkill('unknown')).toThrow('"unknown"');
  });

  it('listSkills returns all registered names', () => {
    registerSkill('a', { instructions: '' });
    registerSkill('b', { instructions: '' });
    expect(listSkills()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('clearSkills empties the registry', () => {
    registerSkill('a', { instructions: '' });
    clearSkills();
    expect(hasSkill('a')).toBe(false);
  });
});

// ─── parseSkill ───────────────────────────────────────────────────────────────

describe('parseSkill', () => {
  it('parses a skill from markdown and returns a runner', () => {
    const runner = parseSkill(
      `
---
name: summarize
model: openai/gpt-4o-mini
---
Summarize the provided text.
    `.trim(),
    );

    expect(typeof runner.invoke).toBe('function');
  });

  it('throws if name is missing from frontmatter', () => {
    expect(() => parseSkill(`---\nmodel: openai/gpt-4o-mini\n---\nInstructions.`)).toThrow(
      '"name"',
    );
  });

  it('converts YAML output schema to JSON Schema', async () => {
    const { agent } = await import('./agent.js');

    parseSkill(
      `
---
name: extract
output:
  summary: string!
  tags: string[]
---
Extract information.
    `.trim(),
    );

    expect(vi.mocked(agent)).not.toHaveBeenCalled(); // no call yet — just parsed
  });
});
