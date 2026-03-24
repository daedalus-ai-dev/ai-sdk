# refine()

Run an iterative refinement loop — the evaluator-optimizer pattern codified as a primitive.

Calls `step` repeatedly. After each step, `until` decides whether the result is good enough. `until` receives both the **current** state and the **previous** state, so you can detect stalled progress and bail early rather than burning iterations.

## When to use refine vs other primitives

| | `refine()` | `workflow()` | `agent()` |
|---|---|---|---|
| **Shape** | Dynamic loop, N iterations | Fixed stages | Unbounded tool loop |
| **Control** | Code-defined exit condition | Code-defined stages | LLM-decided |
| **Use for** | Iterate until quality threshold | Fan-out/fan-in stages | Autonomous reasoning |

---

## `refine(config)`

```ts
async function refine<TState, TOutput>(
  config: RefineConfig<TState, TOutput>,
): Promise<RefineResult<TOutput>>
```

### `RefineConfig`

```ts
interface RefineConfig<TState, TOutput> {
  state: TState;
  step: (state: TState, iteration: number) => Promise<TState>;
  until: (
    current: TState,
    previous: TState,
  ) => { done: true; output: TOutput } | { done: false };
  maxIterations?: number; // default: 10
}
```

| Field | Description |
|-------|-------------|
| `state` | Initial state passed to the first `step` call. |
| `step` | Work function. Receives current state and 1-based iteration number. Returns next state. |
| `until` | Exit condition. `previous` is the initial state on the first call, the prior state on subsequent calls. Return `{ done: true, output }` to stop. |
| `maxIterations` | Hard ceiling. Throws `RefineLimitError` if reached. Default `10`. |

### `RefineResult`

```ts
interface RefineResult<TOutput> {
  output: TOutput;
  iterations: number;
}
```

---

## Examples

### TDD — red / green / refactor

```ts
import { refine, skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

const implementer = skill({
  instructions: 'Write TypeScript code that satisfies the spec. Fix the errors if any are provided.',
  output: z.object({ code: z.string() }),
});

const testRunner = skill({
  instructions: 'Run the tests for the provided code. Return any errors.',
  output: z.object({ errors: z.array(z.string()) }),
});

const { output: code, iterations } = await refine({
  state: { spec: 'Write a function that adds two numbers.', code: '', errors: [] as string[] },
  step: async (s) => {
    const { code }   = (await implementer.invoke({ spec: s.spec, errors: s.errors })).structured;
    const { errors } = (await testRunner.invoke(code)).structured;
    return { ...s, code, errors };
  },
  until: (curr, prev) => {
    if (curr.errors.length === 0) return { done: true, output: curr.code };
    if (curr.code === prev.code)  return { done: true, output: curr.code }; // no progress
    return { done: false };
  },
  maxIterations: 5,
});

console.log(`Done in ${iterations} iteration(s).`);
```

### BDD three-amigos — loop until consensus

```ts
const { output: criteria } = await refine({
  state: {
    story: 'As a user I want to reset my password...',
    questions: [] as string[],
    consensus: false,
    criteria: '',
  },
  step: async (s) => {
    const [devFeedback, qaFeedback] = await Promise.all([
      dev.invoke(s).then(r => r.structured),
      qa.invoke(s).then(r => r.structured),
    ]);
    // PO answers questions and signals consensus when ready
    return po.invoke({ ...s, devFeedback, qaFeedback }).then(r => r.structured);
  },
  until: (curr, prev) => {
    if (curr.consensus) return { done: true, output: curr.criteria };
    // No new questions raised — stuck, bail out with what we have
    if (JSON.stringify(curr.questions) === JSON.stringify(prev.questions)) {
      return { done: true, output: curr.criteria };
    }
    return { done: false };
  },
  maxIterations: 6,
});
```

### Search / replace / validate

```ts
const { output: fixedCode } = await refine({
  state: { code: originalCode, errors: [] as string[] },
  step: async (s) => {
    const { code }   = (await editor.invoke(s)).structured;
    const { errors } = (await linter.invoke(code)).structured;
    return { code, errors };
  },
  until: (curr, prev) => {
    if (curr.errors.length === 0) return { done: true, output: curr.code };
    if (curr.code === prev.code)  return { done: true, output: curr.code }; // no progress
    return { done: false };
  },
});
```

---

## `RefineLimitError`

Thrown when `maxIterations` is reached without `until()` returning `{ done: true }`.

```ts
class RefineLimitError extends Error {
  maxIterations: number;
  lastState: unknown;
}
```

Inspect `lastState` to understand what the loop was stuck on:

```ts
import { refine, RefineLimitError } from '@daedalus-ai-dev/ai-sdk';

try {
  await refine({ ... });
} catch (e) {
  if (e instanceof RefineLimitError) {
    console.error(`Gave up after ${e.maxIterations} iterations.`);
    console.error('Last state:', e.lastState);
  }
}
```

---

## Using `previous` to detect stalled progress

The most important feature of `until` over a simple `while` loop: you always know if the last step actually changed anything.

```ts
until: (curr, prev) => {
  // Primary exit — goal reached
  if (curr.testsPass) return { done: true, output: curr.code };

  // Safety exit — LLM produced the same output twice, no point continuing
  if (curr.code === prev.code) return { done: true, output: curr.code };

  return { done: false };
},
```

Without the `prev` check you'd burn all remaining iterations producing identical results.
