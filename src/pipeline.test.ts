import { describe, it, expect } from 'vitest';
import { Pipeline } from './pipeline.js';

describe('Pipeline', () => {
  it('passes payload through all steps in order', async () => {
    const result = await Pipeline.send({ value: 0 })
      .through([
        async (p, next) => next({ value: p.value + 1 }),
        async (p, next) => next({ value: p.value * 2 }),
        async (p, next) => next({ value: p.value + 10 }),
      ])
      .thenReturn();

    expect(result.value).toBe(12); // (0+1)*2+10
  });

  it('returns initial payload with no steps', async () => {
    const result = await Pipeline.send({ x: 42 }).through([]).thenReturn();
    expect(result.x).toBe(42);
  });

  it('supports early return by not calling next', async () => {
    const result = await Pipeline.send({ value: 1, stop: true })
      .through([
        async (p, next) => (p.stop ? p : next({ ...p, value: p.value + 100 })),
        async (p, next) => next({ ...p, value: p.value + 999 }),
      ])
      .thenReturn();

    expect(result.value).toBe(1); // stopped early
  });

  it('supports async steps', async () => {
    const result = await Pipeline.send({ items: [] as string[] })
      .through([
        async (p, next) => {
          await Promise.resolve();
          return next({ items: [...p.items, 'a'] });
        },
        async (p, next) => {
          await Promise.resolve();
          return next({ items: [...p.items, 'b'] });
        },
      ])
      .thenReturn();

    expect(result.items).toEqual(['a', 'b']);
  });
});
