import { describe, expect, it } from 'vitest';
import { buildSchema, schema } from './schema.js';

describe('buildSchema', () => {
  it('builds a simple object schema', () => {
    const result = buildSchema((s) => ({
      name: s.string().required(),
      age: s.integer().min(0).max(150).required(),
      bio: s.string(),
    }));

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer', minimum: 0, maximum: 150 },
        bio: { type: 'string' },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    });
  });

  it('handles enum, boolean, and array', () => {
    const result = buildSchema((s) => ({
      status: s.enum(['active', 'inactive']).required(),
      enabled: s.boolean().required(),
      tags: s.array().items(s.string().toSchema()),
    }));

    expect(result.properties.status).toEqual({ type: 'string', enum: ['active', 'inactive'] });
    expect(result.properties.enabled).toEqual({ type: 'boolean' });
    expect(result.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(result.required).toEqual(['status', 'enabled']);
  });

  it('adds descriptions', () => {
    const result = buildSchema((s) => ({
      score: s.integer().description('Quality score from 1-10').min(1).max(10).required(),
    }));

    expect(result.properties.score).toMatchObject({ description: 'Quality score from 1-10' });
  });

  it('omits required array when no required fields', () => {
    const result = buildSchema((s) => ({
      optional: s.string(),
    }));

    expect(result.required).toBeUndefined();
  });

  it('schema builder singleton works standalone', () => {
    const s = schema.integer().min(1).max(10).required();
    expect(s._required).toBe(true);
    expect(s.toSchema()).toEqual({ type: 'integer', minimum: 1, maximum: 10 });
  });
});
