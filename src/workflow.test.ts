import { describe, it, expect, vi } from 'vitest';
import { workflow, fromSkill, parseWorkflow, WorkflowStep } from './workflow.js';

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
    expect(result.stages[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates rejections immediately', async () => {
    const runner = workflow<string>()
      .step({
        name: 'fail',
        run: async () => { throw new Error('step failed'); },
      })
      .build();

    await expect(runner.run('x')).rejects.toThrow('step failed');
  });
});

// ─── Parallel stage ───────────────────────────────────────────────────────────

describe('.parallel()', () => {
  it('passes the same input to all steps', async () => {
    const received: unknown[] = [];
    const spy = (label: string) => makeStep(label, (v: string) => {
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
        steps: [
          makeStep('x2', (n: number) => n * 2),
          makeStep('x3', (n: number) => n * 3),
        ],
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
    expect(result.stages[0]!.name).toBeUndefined();
  });

  it('fails the whole stage if any step rejects', async () => {
    const runner = workflow<string>()
      .parallel({
        steps: [
          makeStep('ok', () => 'fine'),
          {
            name: 'bad',
            run: async () => { throw new Error('parallel step failed'); },
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
      .step(makeStep('double', (n: number) => n * 2))                 // 3 → 6
      .parallel({
        steps: [makeStep('p1', (n: number) => n + 1), makeStep('p2', (n: number) => n + 2)],
        accumulate: async (nums: number[]) => nums.reduce((a, b) => a + b, 0), // [7,8] → 15
      })
      .step(makeStep('negate', (n: number) => -n))                    // 15 → -15
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
    expect(() =>
      parseWorkflow(`---\nstages:\n  - step: upper\n---`, registry),
    ).toThrow('"name"');
  });

  it('throws if "stages" is missing', () => {
    expect(() =>
      parseWorkflow(`---\nname: bad\n---`, registry),
    ).toThrow('at least one stage');
  });

  it('throws if a step name is not in the registry', () => {
    expect(() =>
      parseWorkflow(
        `---\nname: bad\nstages:\n  - step: missing-step\n---`,
        registry,
      ),
    ).toThrow('"missing-step"');
  });
});
