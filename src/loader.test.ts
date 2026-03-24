import { describe, it, expect, beforeEach } from 'vitest';
import { parseSkill, registerSkill, clearSkills, hasSkill, getSkill, listSkills } from './skill.js';
import { parseAgent, yamlSchemaToJsonSchema } from './loader.js';
import { clearAgents } from './registry.js';
import { defineTool } from './tool.js';

beforeEach(() => {
  clearSkills();
  clearAgents();
});

// ─── parseSkill ───────────────────────────────────────────────────────────────

describe('parseSkill', () => {
  it('parses name and instructions from frontmatter + body', () => {
    const skill = parseSkill(`
---
name: summarizer
description: Condenses content
---
Summarize the content in bullet points.
    `.trim());

    expect(skill.name).toBe('summarizer');
    expect(skill.description).toBe('Condenses content');
    expect(skill.instructions).toBe('Summarize the content in bullet points.');
  });

  it('throws if name is missing', () => {
    expect(() => parseSkill(`---\ndescription: no name\n---\nbody`))
      .toThrow('"name"');
  });

  it('trims whitespace from instructions', () => {
    const skill = parseSkill(`---\nname: test\n---\n\n  body  \n`);
    expect(skill.instructions).toBe('body');
  });
});

// ─── skill registry ───────────────────────────────────────────────────────────

describe('skill registry', () => {
  it('registers and retrieves skills', () => {
    registerSkill('foo', { name: 'foo', instructions: 'do foo' });
    expect(hasSkill('foo')).toBe(true);
    expect(getSkill('foo').instructions).toBe('do foo');
  });

  it('listSkills returns all registered names', () => {
    registerSkill('a', { name: 'a', instructions: '' });
    registerSkill('b', { name: 'b', instructions: '' });
    expect(listSkills()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('getSkill throws for unknown skill', () => {
    expect(() => getSkill('unknown')).toThrow('"unknown"');
  });

  it('clearSkills empties the registry', () => {
    registerSkill('a', { name: 'a', instructions: '' });
    clearSkills();
    expect(hasSkill('a')).toBe(false);
  });
});

// ─── yamlSchemaToJsonSchema ───────────────────────────────────────────────────

describe('yamlSchemaToJsonSchema', () => {
  it('converts string shorthand', () => {
    const schema = yamlSchemaToJsonSchema({ field: 'string' });
    expect(schema.properties['field']).toEqual({ type: 'string' });
    expect(schema.required).toBeUndefined();
  });

  it('marks required with ! suffix', () => {
    const schema = yamlSchemaToJsonSchema({ name: 'string!', age: 'number!' });
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('converts array shorthand', () => {
    const schema = yamlSchemaToJsonSchema({ tags: 'string[]' });
    expect(schema.properties['tags']).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('converts object form with required flag', () => {
    const schema = yamlSchemaToJsonSchema({
      summary: { type: 'string', required: true, description: 'A summary' },
    });
    expect(schema.properties['summary']).toMatchObject({ type: 'string', description: 'A summary' });
    expect(schema.required).toContain('summary');
  });

  it('converts nested array items', () => {
    const schema = yamlSchemaToJsonSchema({
      items: { type: 'array', items: 'number' },
    });
    expect(schema.properties['items']).toEqual({ type: 'array', items: { type: 'number' } });
  });
});

// ─── parseAgent ───────────────────────────────────────────────────────────────

describe('parseAgent', () => {
  const md = `
---
name: assistant
model: openai/gpt-4o-mini
---
You are a helpful assistant.
  `.trim();

  it('returns an AgentRunner (has prompt and stream methods)', () => {
    const runner = parseAgent(md);
    expect(typeof runner.prompt).toBe('function');
    expect(typeof runner.stream).toBe('function');
  });

  it('resolves tools by name from options', () => {
    const tool = defineTool({
      name: 'my-tool',
      description: 'does stuff',
      schema: (s) => ({ input: s.string().required() }),
      handle: async () => 'result',
    });

    const runner = parseAgent(
      `---\nname: agent\ntools:\n  - my-tool\n---\nYou use tools.`,
      { tools: { 'my-tool': tool } },
    );
    expect(runner).toBeDefined();
  });

  it('throws if a required tool is missing from options', () => {
    expect(() =>
      parseAgent(`---\nname: agent\ntools:\n  - missing-tool\n---\nbody`),
    ).toThrow('"missing-tool"');
  });

  it('interpolates {{skill:name}} in instructions', () => {
    registerSkill('greeting', { name: 'greeting', instructions: 'Always say hello first.' });

    // We can't read private fields on AgentRunner, but parsing should not throw
    expect(() =>
      parseAgent(`---\nname: agent\n---\n{{skill:greeting}}\nThen help the user.`),
    ).not.toThrow();
  });

  it('throws if a referenced skill is not registered', () => {
    expect(() =>
      parseAgent(`---\nname: agent\n---\n{{skill:unknown}}`),
    ).toThrow('"unknown"');
  });

  it('throws if name is missing', () => {
    expect(() => parseAgent(`---\ndescription: no name\n---\nbody`)).toThrow('"name"');
  });
});
