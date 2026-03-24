import { describe, expect, it, vi } from 'vitest';
import { RefineLimitError, refine } from './refine.js';

// ─── Basic behaviour ──────────────────────────────────────────────────────────

describe('refine()', () => {
  it('resolves immediately when until() returns done on the first iteration', async () => {
    const result = await refine({
      state: 0,
      step: async (n) => n + 1,
      until: (curr) => ({ done: true, output: curr }),
    });

    expect(result.output).toBe(1);
    expect(result.iterations).toBe(1);
  });

  it('loops until the condition is met', async () => {
    const result = await refine({
      state: 0,
      step: async (n) => n + 1,
      until: (curr) => (curr >= 3 ? { done: true, output: curr } : { done: false }),
    });

    expect(result.output).toBe(3);
    expect(result.iterations).toBe(3);
  });

  it('passes 1-based iteration number to step', async () => {
    const iterations: number[] = [];

    await refine({
      state: 0,
      step: async (n, i) => {
        iterations.push(i);
        return n + 1;
      },
      until: (curr) => (curr >= 2 ? { done: true, output: curr } : { done: false }),
    });

    expect(iterations).toEqual([1, 2]);
  });

  it('passes initial state as previous on the first call to until()', async () => {
    const previousValues: number[] = [];

    await refine({
      state: 10,
      step: async (n) => n + 1,
      until: (curr, prev) => {
        previousValues.push(prev);
        return curr >= 12 ? { done: true, output: curr } : { done: false };
      },
    });

    // previous for iteration 1 = initial state (10)
    // previous for iteration 2 = state after step 1 (11)
    expect(previousValues).toEqual([10, 11]);
  });

  it('passes the previous state (not the initial) on subsequent iterations', async () => {
    const seen: Array<{ curr: number; prev: number }> = [];

    await refine({
      state: 0,
      step: async (n) => n + 5,
      until: (curr, prev) => {
        seen.push({ curr, prev });
        return curr >= 10 ? { done: true, output: curr } : { done: false };
      },
    });

    expect(seen).toEqual([
      { curr: 5, prev: 0 },
      { curr: 10, prev: 5 },
    ]);
  });

  it('returns output exactly as provided by until()', async () => {
    const result = await refine({
      state: { value: 'hello' },
      step: async (s) => ({ value: `${s.value}!` }),
      until: (curr) =>
        curr.value.endsWith('!!!')
          ? { done: true, output: { final: curr.value } }
          : { done: false },
    });

    expect(result.output).toEqual({ final: 'hello!!!' });
  });
});

// ─── No-progress detection ────────────────────────────────────────────────────

describe('no-progress detection via previous state', () => {
  it('allows until() to bail when current === previous (stalled loop)', async () => {
    // step always returns the same state — no progress
    const step = vi.fn(async (s: { code: string }) => s);

    const result = await refine({
      state: { code: 'broken' },
      step,
      until: (curr, prev) => {
        if (curr.code === prev.code) return { done: true, output: curr.code };
        if (curr.code === 'fixed') return { done: true, output: curr.code };
        return { done: false };
      },
      maxIterations: 10,
    });

    // Bails after one step because code didn't change
    expect(result.iterations).toBe(1);
    expect(result.output).toBe('broken');
    expect(step).toHaveBeenCalledTimes(1);
  });
});

// ─── maxIterations ────────────────────────────────────────────────────────────

describe('maxIterations', () => {
  it('throws RefineLimitError when maxIterations is exceeded', async () => {
    await expect(
      refine({
        state: 0,
        step: async (n) => n + 1,
        until: () => ({ done: false }),
        maxIterations: 3,
      }),
    ).rejects.toThrow(RefineLimitError);
  });

  it('RefineLimitError includes the limit and last state', async () => {
    let caught: RefineLimitError | undefined;

    try {
      await refine({
        state: { attempt: 0 },
        step: async (s) => ({ attempt: s.attempt + 1 }),
        until: () => ({ done: false }),
        maxIterations: 2,
      });
    } catch (e) {
      caught = e as RefineLimitError;
    }

    expect(caught).toBeInstanceOf(RefineLimitError);
    expect(caught?.maxIterations).toBe(2);
    expect(caught?.lastState).toEqual({ attempt: 2 });
  });

  it('defaults to maxIterations of 10', async () => {
    const step = vi.fn(async (n: number) => n + 1);

    await expect(refine({ state: 0, step, until: () => ({ done: false }) })).rejects.toThrow(
      RefineLimitError,
    );

    expect(step).toHaveBeenCalledTimes(10);
  });

  it('succeeds on exactly the last allowed iteration', async () => {
    const result = await refine({
      state: 0,
      step: async (n) => n + 1,
      until: (curr) => (curr === 3 ? { done: true, output: curr } : { done: false }),
      maxIterations: 3,
    });

    expect(result.output).toBe(3);
    expect(result.iterations).toBe(3);
  });
});

// ─── Error propagation ────────────────────────────────────────────────────────

describe('error propagation', () => {
  it('propagates errors thrown inside step()', async () => {
    await expect(
      refine({
        state: 0,
        step: async () => {
          throw new Error('step blew up');
        },
        until: () => ({ done: false }),
      }),
    ).rejects.toThrow('step blew up');
  });

  it('propagates errors thrown inside until()', async () => {
    await expect(
      refine({
        state: 0,
        step: async (n) => n + 1,
        until: () => {
          throw new Error('until blew up');
        },
      }),
    ).rejects.toThrow('until blew up');
  });
});
