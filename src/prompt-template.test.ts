import { describe, expect, it } from 'vitest';
import { createPrompt, promptTemplate } from './prompt-template.js';

describe('promptTemplate', () => {
  it('interpolates variables into the template', () => {
    const greet = promptTemplate`Hello, ${'name'}!`;
    expect(greet({ name: 'Alice' })).toBe('Hello, Alice!');
  });

  it('handles multiple variables', () => {
    const greet = promptTemplate`Hello, ${'name'}! You are a ${'role'}.`;
    expect(greet({ name: 'Bob', role: 'developer' })).toBe('Hello, Bob! You are a developer.');
  });

  it('handles no variables', () => {
    const fixed = promptTemplate`Just a static string.`;
    expect(fixed({} as never)).toBe('Just a static string.');
  });

  it('handles adjacent variables', () => {
    const t = promptTemplate`${'a'}${'b'}`;
    expect(t({ a: 'foo', b: 'bar' })).toBe('foobar');
  });

  it('handles variable at the start', () => {
    const t = promptTemplate`${'prefix'} world`;
    expect(t({ prefix: 'hello' })).toBe('hello world');
  });

  it('handles variable at the end', () => {
    const t = promptTemplate`hello ${'suffix'}`;
    expect(t({ suffix: 'world' })).toBe('hello world');
  });

  it('handles multiline templates', () => {
    const t = promptTemplate`Line 1: ${'a'}
Line 2: ${'b'}`;
    expect(t({ a: 'foo', b: 'bar' })).toBe('Line 1: foo\nLine 2: bar');
  });

  it('returns a reusable function', () => {
    const t = promptTemplate`Value: ${'x'}`;
    expect(t({ x: '1' })).toBe('Value: 1');
    expect(t({ x: '2' })).toBe('Value: 2');
  });
});

describe('createPrompt', () => {
  it('replaces {{variable}} placeholders', () => {
    const greet = createPrompt('Hello, {{name}}!');
    expect(greet({ name: 'Alice' })).toBe('Hello, Alice!');
  });

  it('handles multiple placeholders', () => {
    const t = createPrompt('Hello, {{name}}! You are a {{role}}.');
    expect(t({ name: 'Bob', role: 'developer' })).toBe('Hello, Bob! You are a developer.');
  });

  it('handles the same placeholder multiple times', () => {
    const t = createPrompt('{{word}} is {{word}}');
    expect(t({ word: 'code' })).toBe('code is code');
  });

  it('handles no placeholders', () => {
    const t = createPrompt('No variables here.');
    expect(t({})).toBe('No variables here.');
  });

  it('throws for missing variables', () => {
    const t = createPrompt('Hello, {{name}}!');
    expect(() => t({})).toThrow('Missing template variable: "name"');
  });

  it('ignores extra variables', () => {
    const t = createPrompt('Hello, {{name}}!');
    expect(t({ name: 'Alice', extra: 'ignored' })).toBe('Hello, Alice!');
  });

  it('handles placeholders next to each other', () => {
    const t = createPrompt('{{a}}{{b}}');
    expect(t({ a: 'foo', b: 'bar' })).toBe('foobar');
  });

  it('returns a reusable function', () => {
    const t = createPrompt('Value: {{x}}');
    expect(t({ x: '1' })).toBe('Value: 1');
    expect(t({ x: '2' })).toBe('Value: 2');
  });

  it('handles underscored placeholder names', () => {
    const t = createPrompt('{{first_name}} {{last_name}}');
    expect(t({ first_name: 'John', last_name: 'Doe' })).toBe('John Doe');
  });
});
