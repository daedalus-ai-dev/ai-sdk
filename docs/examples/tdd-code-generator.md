# TDD Code Generator

Generate TypeScript code by following the red → green → refactor cycle. A test-writer agent writes failing tests from a specification, an implementer makes them pass, and a refactorer cleans up — repeating until the validator confirms the tests pass and the code is clean.

Uses [`refine()`](/api/refine) to drive the loop and detect stalled progress.

## Full example

```ts
import { refine, skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

// ─── Skills ──────────────────────────────────────────────────────────────────

const testWriter = skill({
  instructions: `
    Write Vitest unit tests for the TypeScript function described in the spec.
    Cover happy path, edge cases, and error handling.
    Output only valid TypeScript — no markdown fences.
  `,
  output: z.object({ tests: z.string() }),
});

const implementer = skill({
  instructions: `
    Write a TypeScript implementation that passes the provided tests.
    If errors are provided, fix them. Output only valid TypeScript — no markdown fences.
  `,
  output: z.object({ code: z.string() }),
});

const validator = skill({
  instructions: `
    You are a TypeScript compiler and test runner simulation.
    Given code and tests, identify type errors and test failures.
    Return an empty errors array if everything is correct.
  `,
  output: z.object({
    errors: z.array(z.string()),
    testsPass: z.boolean(),
  }),
});

const refactorer = skill({
  instructions: `
    Refactor the TypeScript code for clarity and idiomatic style.
    Do not change behaviour. Output only valid TypeScript — no markdown fences.
  `,
  output: z.object({ code: z.string() }),
});

// ─── TDD loop ─────────────────────────────────────────────────────────────────

type State = {
  spec: string;
  tests: string;
  code: string;
  errors: string[];
  testsPass: boolean;
  refactored: boolean;
};

const spec = `
  Write a function \`chunk<T>(array: T[], size: number): T[][]\` that splits an
  array into chunks of the given size. The last chunk may be smaller.
`;

const { output: finalCode, iterations } = await refine<State, string>({
  state: { spec, tests: '', code: '', errors: [], testsPass: false, refactored: false },

  step: async (s, iteration) => {
    // RED: write tests on the first iteration (or if we have no tests yet)
    const tests = s.tests
      ? s.tests
      : (await testWriter.invoke({ spec: s.spec })).structured.tests;

    // GREEN: implement or fix based on errors
    const { code } = (
      await implementer.invoke({ spec: s.spec, tests, errors: s.errors })
    ).structured;

    // Validate
    const { errors, testsPass } = (await validator.invoke({ code, tests })).structured;

    // REFACTOR on green with no prior refactor
    if (testsPass && !s.refactored) {
      const { code: refactored } = (await refactorer.invoke({ code })).structured;
      return { ...s, tests, code: refactored, errors: [], testsPass: true, refactored: true };
    }

    return { ...s, tests, code, errors, testsPass };
  },

  until: (curr, prev) => {
    // Done: tests pass and code was refactored
    if (curr.testsPass && curr.refactored) return { done: true, output: curr.code };
    // Stalled: code didn't change between iterations
    if (curr.code === prev.code && curr.errors.length > 0) return { done: true, output: curr.code };
    return { done: false };
  },

  maxIterations: 6,
});

console.log(`Done in ${iterations} iteration(s).\n`);
console.log(finalCode);
```

## How it works

| Iteration | What happens |
|-----------|-------------|
| 1 | Test-writer drafts tests from the spec (RED — no impl yet) |
| 2+ | Implementer writes/fixes code; validator checks it |
| First green | Refactorer cleans up the passing code |
| Done | `testsPass && refactored` — or stalled (code unchanged despite errors) |

## Stall detection

The `until` function receives both `current` and `previous` state. If the implementer produces the same output twice in a row while errors remain, the loop exits rather than burning more iterations on a stuck model:

```ts
if (curr.code === prev.code && curr.errors.length > 0) return { done: true, output: curr.code };
```

## Tips

- Give the validator a concrete rubric — "TypeScript compiles and all tests pass" is better than "is it correct?"
- Keep `maxIterations` conservative (5–6). If the model can't fix the same error in 3 attempts, more iterations rarely help.
- The refactorer runs only once (guarded by `s.refactored`) to avoid drifting the code after it's already clean.
