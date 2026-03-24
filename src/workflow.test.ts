import { describe, expect, it, vi } from 'vitest';
import {
  fromSkill,
  inMemoryCheckpointStore,
  parseWorkflow,
  type WorkflowStep,
  workflow,
} from './workflow.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStep<TIn, TOut>(name: string, fn: (input: TIn) => TOut): WorkflowStep<TIn, TOut> {
  return { name, run: async (input) => fn(input) };
}

// ─── workflow() / WorkflowBuilder ─────────────────────────────────────────────

describe('workflow()', () => {
  it('returns a builder with parallel() and step() and build()', () => {
    const builder = workflow();
    expect(typeof builder.parallel).toBe('function');
    expect(typeof builder.step).toBe('function');
    expect(typeof builder.build).toBe('function');
  });

  it('build() returns a runner with a run() method', () => {
    const runner = workflow().build();
    expect(typeof runner.run).toBe('function');
  });

  it('no-op workflow passes input straight through as output', async () => {
    const runner = workflow<string>().build();
    const result = await runner.run('hello');
    expect(result.output).toBe('hello');
    expect(result.stages).toHaveLength(0);
  });
});

// ─── Serial step ──────────────────────────────────────────────────────────────

describe('.step()', () => {
  it('transforms input to output', async () => {
    const runner = workflow<number>()
      .step(makeStep('double', (n) => n * 2))
      .build();

    const result = await runner.run(5);
    expect(result.output).toBe(10);
  });

  it('chains multiple steps, passing output of each as input to the next', async () => {
    const runner = workflow<number>()
      .step(makeStep('double', (n: number) => n * 2))
      .step(makeStep('add-one', (n: number) => n + 1))
      .build();

    const result = await runner.run(3); // 3 → 6 → 7
    expect(result.output).toBe(7);
  });

  it('records a serial stage result with step name and durationMs', async () => {
    const runner = workflow<string>()
      .step(makeStep('upper', (s: string) => s.toUpperCase()))
      .build();

    const result = await runner.run('hi');
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({ type: 'serial', name: 'upper' });
    expect(result.stages[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates rejections immediately', async () => {
    const runner = workflow<string>()
      .step({
        name: 'fail',
        run: async () => {
          throw new Error('step failed');
        },
      })
      .build();

    await expect(runner.run('x')).rejects.toThrow('step failed');
  });
});

// ─── Parallel stage ───────────────────────────────────────────────────────────

describe('.parallel()', () => {
  it('passes the same input to all steps', async () => {
    const received: unknown[] = [];
    const spy = (label: string) =>
      makeStep(label, (v: string) => {
        received.push(v);
        return label;
      });

    const runner = workflow<string>()
      .parallel({
        steps: [spy('a'), spy('b'), spy('c')],
        accumulate: async (results) => results.join(','),
      })
      .build();

    await runner.run('shared');
    expect(received).toEqual(['shared', 'shared', 'shared']);
  });

  it('runs steps concurrently and passes results array to accumulate', async () => {
    const accumulate = vi.fn(async (results: number[]) => results.reduce((a, b) => a + b, 0));

    const runner = workflow<number>()
      .parallel({
        steps: [makeStep('x2', (n: number) => n * 2), makeStep('x3', (n: number) => n * 3)],
        accumulate,
      })
      .build();

    const result = await runner.run(4); // [8, 12] → 20
    expect(accumulate).toHaveBeenCalledWith([8, 12]);
    expect(result.output).toBe(20);
  });

  it('records a parallel stage result without a name', async () => {
    const runner = workflow<string>()
      .parallel({
        steps: [makeStep('a', (s: string) => s), makeStep('b', (s: string) => s)],
        accumulate: async (results) => results,
      })
      .build();

    const result = await runner.run('x');
    expect(result.stages[0]).toMatchObject({ type: 'parallel' });
    expect(result.stages[0]?.name).toBeUndefined();
  });

  it('fails the whole stage if any step rejects', async () => {
    const runner = workflow<string>()
      .parallel({
        steps: [
          makeStep('ok', () => 'fine'),
          {
            name: 'bad',
            run: async () => {
              throw new Error('parallel step failed');
            },
          },
        ],
        accumulate: async (r) => r,
      })
      .build();

    await expect(runner.run('x')).rejects.toThrow('parallel step failed');
  });
});

// ─── Mixed stages ─────────────────────────────────────────────────────────────

describe('mixed stages', () => {
  it('serial → parallel → serial chain works end to end', async () => {
    const runner = workflow<number>()
      .step(makeStep('double', (n: number) => n * 2)) // 3 → 6
      .parallel({
        steps: [makeStep('p1', (n: number) => n + 1), makeStep('p2', (n: number) => n + 2)],
        accumulate: async (nums: number[]) => nums.reduce((a, b) => a + b, 0), // [7,8] → 15
      })
      .step(makeStep('negate', (n: number) => -n)) // 15 → -15
      .build();

    const result = await runner.run(3);
    expect(result.output).toBe(-15);
    expect(result.stages).toHaveLength(3);
    expect(result.stages.map((s) => s.type)).toEqual(['serial', 'parallel', 'serial']);
  });
});

// ─── fromSkill() ──────────────────────────────────────────────────────────────

describe('fromSkill()', () => {
  it('wraps a SkillRunner, returning .structured as step output', async () => {
    const mockRunner = {
      invoke: vi.fn().mockResolvedValue({
        text: 'ok',
        structured: { label: 'positive' },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };

    const step = fromSkill('classify', mockRunner);
    const output = await step.run({ text: 'great!' });

    expect(output).toEqual({ label: 'positive' });
    expect(mockRunner.invoke).toHaveBeenCalledWith({ text: 'great!' });
  });

  it('uses the provided name', () => {
    const step = fromSkill('my-step', { invoke: vi.fn() } as any);
    expect(step.name).toBe('my-step');
  });
});

// ─── parseWorkflow() ──────────────────────────────────────────────────────────

describe('parseWorkflow()', () => {
  const upper = makeStep('upper', (s: string) => (s as string).toUpperCase());
  const exclaim = makeStep('exclaim', (s: string) => `${s}!`);
  const joinStep = makeStep('join', (parts: string[]) => parts.join('-'));

  const registry = {
    upper: upper as WorkflowStep<unknown, unknown>,
    exclaim: exclaim as WorkflowStep<unknown, unknown>,
    join: joinStep as WorkflowStep<unknown, unknown>,
  };

  it('parses a serial-only workflow and runs it', async () => {
    const runner = parseWorkflow(
      `---
name: test-workflow
stages:
  - step: upper
  - step: exclaim
---
A simple workflow.`,
      registry,
    );

    const result = await runner.run('hello');
    expect(result.output).toBe('HELLO!');
  });

  it('parses a parallel stage and runs it', async () => {
    const runner = parseWorkflow(
      `---
name: parallel-workflow
stages:
  - parallel:
      steps: [upper, exclaim]
      accumulate: join
---`,
      registry,
    );

    const result = await runner.run('hi');
    // upper('hi') = 'HI', exclaim('hi') = 'hi!'
    // join(['HI', 'hi!']) = 'HI-hi!'
    expect(result.output).toBe('HI-hi!');
  });

  it('throws if "name" is missing from frontmatter', () => {
    expect(() => parseWorkflow(`---\nstages:\n  - step: upper\n---`, registry)).toThrow('"name"');
  });

  it('throws if "stages" is missing', () => {
    expect(() => parseWorkflow(`---\nname: bad\n---`, registry)).toThrow('at least one stage');
  });

  it('throws if a step name is not in the registry', () => {
    expect(() =>
      parseWorkflow(`---\nname: bad\nstages:\n  - step: missing-step\n---`, registry),
    ).toThrow('"missing-step"');
  });
});

// ─── .branch() ────────────────────────────────────────────────────────────────

describe('.branch()', () => {
  it('routes to the matching case', async () => {
    const runner = workflow<{ type: string; value: number }>()
      .branch({
        name: 'router',
        select: (input) => input.type,
        cases: {
          double: makeStep('double', (i: { value: number }) => i.value * 2),
          triple: makeStep('triple', (i: { value: number }) => i.value * 3),
        },
      })
      .build();

    expect((await runner.run({ type: 'double', value: 5 })).output).toBe(10);
    expect((await runner.run({ type: 'triple', value: 5 })).output).toBe(15);
  });

  it('uses the default when no case matches', async () => {
    const runner = workflow<string>()
      .branch({
        name: 'router',
        select: (s) => s,
        cases: { known: makeStep('known', () => 'known result') },
        default: makeStep('default', () => 'default result'),
      })
      .build();

    expect((await runner.run('unknown')).output).toBe('default result');
  });

  it('throws when no case matches and no default', async () => {
    const runner = workflow<string>()
      .branch({
        name: 'router',
        select: (s) => s,
        cases: { known: makeStep('known', () => 'result') },
      })
      .build();

    await expect(runner.run('unknown')).rejects.toThrow('no case for key "unknown"');
  });

  it('records branch stage result with selectedCase', async () => {
    const runner = workflow<string>()
      .branch({
        name: 'router',
        select: (s) => s,
        cases: { a: makeStep('a', () => 'A') },
      })
      .build();

    const { stages } = await runner.run('a');
    expect(stages[0]).toMatchObject({ type: 'branch', name: 'router', selectedCase: 'a' });
  });

  it('chains after a serial step', async () => {
    const runner = workflow<number>()
      .step(makeStep('stringify', (n: number) => (n > 0 ? 'positive' : 'negative')))
      .branch({
        name: 'sign',
        select: (s) => s,
        cases: {
          positive: makeStep('pos', () => 1),
          negative: makeStep('neg', () => -1),
        },
      })
      .build();

    expect((await runner.run(42)).output).toBe(1);
    expect((await runner.run(-7)).output).toBe(-1);
  });
});

// ─── Checkpoint store ─────────────────────────────────────────────────────────

describe('inMemoryCheckpointStore()', () => {
  it('stores and retrieves values by stage index', async () => {
    const store = inMemoryCheckpointStore();
    await store.set(0, 'hello');
    expect(await store.get(0)).toBe('hello');
    expect(await store.get(1)).toBeUndefined();
  });
});

describe('workflow checkpointing', () => {
  it('skips completed stages when resuming', async () => {
    let step1Calls = 0;
    let step2Calls = 0;

    const runner = workflow<number>()
      .step(
        makeStep('step1', (n: number) => {
          step1Calls++;
          return n * 2;
        }),
      )
      .step(
        makeStep('step2', (n: number) => {
          step2Calls++;
          return n + 1;
        }),
      )
      .build();

    const store = inMemoryCheckpointStore();

    // First run — both steps execute
    const result1 = await runner.run(5, { checkpointStore: store });
    expect(result1.output).toBe(11); // 5*2=10, 10+1=11
    expect(step1Calls).toBe(1);
    expect(step2Calls).toBe(1);

    // Second run — both stages are checkpointed, nothing re-executes
    const result2 = await runner.run(5, { checkpointStore: store });
    expect(result2.output).toBe(11);
    expect(step1Calls).toBe(1); // not called again
    expect(step2Calls).toBe(1); // not called again
    expect(result2.stages[0]?.resumed).toBe(true);
    expect(result2.stages[1]?.resumed).toBe(true);
  });

  it('resumes from the last successful stage after partial failure', async () => {
    let step1Calls = 0;
    let step2Calls = 0;
    let shouldFail = true;

    const runner = workflow<number>()
      .step(
        makeStep('step1', (n: number) => {
          step1Calls++;
          return n * 2;
        }),
      )
      .step(
        makeStep('step2', (n: number) => {
          step2Calls++;
          if (shouldFail) throw new Error('transient error');
          return n + 1;
        }),
      )
      .build();

    const store = inMemoryCheckpointStore();

    // First attempt — step1 succeeds, step2 fails
    await expect(runner.run(5, { checkpointStore: store })).rejects.toThrow('transient error');
    expect(step1Calls).toBe(1);
    expect(step2Calls).toBe(1);

    // Second attempt — step1 is resumed from checkpoint, step2 retried
    shouldFail = false;
    const result = await runner.run(5, { checkpointStore: store });
    expect(result.output).toBe(11);
    expect(step1Calls).toBe(1); // not re-run
    expect(step2Calls).toBe(2); // retried
    expect(result.stages[0]?.resumed).toBe(true);
    expect(result.stages[1]?.resumed).toBeUndefined();
  });

  it('works without a checkpoint store (normal run)', async () => {
    const runner = workflow<number>()
      .step(makeStep('double', (n: number) => n * 2))
      .build();

    const result = await runner.run(7);
    expect(result.output).toBe(14);
    expect(result.stages[0]?.resumed).toBeUndefined();
  });
});
