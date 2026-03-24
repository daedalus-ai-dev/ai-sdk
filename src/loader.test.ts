import { beforeEach, describe, expect, it } from 'vitest';
import { parseAgent, yamlSchemaToJsonSchema } from './loader.js';
import {
  clearPartials,
  getPartial,
  hasPartial,
  listPartials,
  parsePartial,
  registerPartial,
} from './partial.js';
import { clearAgents } from './registry.js';
import { defineTool } from './tool.js';

beforeEach(() => {
  clearPartials();
  clearAgents();
});

// ─── parsePartial ─────────────────────────────────────────────────────────────

describe('parsePartial', () => {
  it('parses name and instructions from frontmatter + body', () => {
    const partial = parsePartial(
      `
---
name: summarizer
description: Condenses content
---
Summarize the content in bullet points.
    `.trim(),
    );

    expect(partial.name).toBe('summarizer');
    expect(partial.description).toBe('Condenses content');
    expect(partial.instructions).toBe('Summarize the content in bullet points.');
  });

  it('throws if name is missing', () => {
    expect(() => parsePartial(`---\ndescription: no name\n---\nbody`)).toThrow('"name"');
  });

  it('trims whitespace from instructions', () => {
    const partial = parsePartial(`---\nname: test\n---\n\n  body  \n`);
    expect(partial.instructions).toBe('body');
  });
});

// ─── partial registry ─────────────────────────────────────────────────────────

describe('partial registry', () => {
  it('registers and retrieves partials', () => {
    registerPartial('foo', { name: 'foo', instructions: 'do foo' });
    expect(hasPartial('foo')).toBe(true);
    expect(getPartial('foo').instructions).toBe('do foo');
  });

  it('listPartials returns all registered names', () => {
    registerPartial('a', { name: 'a', instructions: '' });
    registerPartial('b', { name: 'b', instructions: '' });
    expect(listPartials()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('getPartial throws for unknown partial', () => {
    expect(() => getPartial('unknown')).toThrow('"unknown"');
  });

  it('clearPartials empties the registry', () => {
    registerPartial('a', { name: 'a', instructions: '' });
    clearPartials();
    expect(hasPartial('a')).toBe(false);
  });
});

// ─── yamlSchemaToJsonSchema ───────────────────────────────────────────────────

describe('yamlSchemaToJsonSchema', () => {
  it('converts string shorthand', () => {
    const schema = yamlSchemaToJsonSchema({ field: 'string' });
    expect(schema.properties.field).toEqual({ type: 'string' });
    expect(schema.required).toBeUndefined();
  });

  it('marks required with ! suffix', () => {
    const schema = yamlSchemaToJsonSchema({ name: 'string!', age: 'number!' });
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('converts array shorthand', () => {
    const schema = yamlSchemaToJsonSchema({ tags: 'string[]' });
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('converts object form with required flag', () => {
    const schema = yamlSchemaToJsonSchema({
      summary: { type: 'string', required: true, description: 'A summary' },
    });
    expect(schema.properties.summary).toMatchObject({
      type: 'string',
      description: 'A summary',
    });
    expect(schema.required).toContain('summary');
  });

  it('converts nested array items', () => {
    const schema = yamlSchemaToJsonSchema({
      items: { type: 'array', items: 'number' },
    });
    expect(schema.properties.items).toEqual({ type: 'array', items: { type: 'number' } });
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

    const runner = parseAgent(`---\nname: agent\ntools:\n  - my-tool\n---\nYou use tools.`, {
      tools: { 'my-tool': tool },
    });
    expect(runner).toBeDefined();
  });

  it('throws if a required tool is missing from options', () => {
    expect(() => parseAgent(`---\nname: agent\ntools:\n  - missing-tool\n---\nbody`)).toThrow(
      '"missing-tool"',
    );
  });

  it('interpolates {{partial:name}} in instructions', () => {
    registerPartial('greeting', { name: 'greeting', instructions: 'Always say hello first.' });

    // We can't read private fields on AgentRunner, but parsing should not throw
    expect(() =>
      parseAgent(`---\nname: agent\n---\n{{partial:greeting}}\nThen help the user.`),
    ).not.toThrow();
  });

  it('throws if a referenced partial is not registered', () => {
    expect(() => parseAgent(`---\nname: agent\n---\n{{partial:unknown}}`)).toThrow('"unknown"');
  });

  it('throws if name is missing', () => {
    expect(() => parseAgent(`---\ndescription: no name\n---\nbody`)).toThrow('"name"');
  });
});
