# `Pipeline`

A sequential pipeline for prompt chaining workflows. Each step receives the current payload and a `next()` function, and must return `next(modifiedPayload)` to continue or `payload` to stop early.

## Signature

```ts
class Pipeline<T> {
  static send<T>(payload: T): Pipeline<T>;
  through(steps: PipelineStep<T>[]): this;
  thenReturn(): Promise<T>;
}

type PipelineStep<T> = (
  payload: T,
  next: (payload: T) => Promise<T>,
) => Promise<T>;
```

## Usage

```ts
import { Pipeline } from '@rokkhopper/ai-sdk';

type Payload = { input: string; summary: string; translation: string };

const result = await Pipeline.send<Payload>({
  input: 'TypeScript is a superset of JavaScript...',
  summary: '',
  translation: '',
})
  .through([
    // Step 1: Summarise
    async (payload, next) => {
      const r = await agent({ instructions: 'Summarise in one sentence.' })
        .prompt(payload.input);
      return next({ ...payload, summary: r.text });
    },
    // Step 2: Translate the summary
    async (payload, next) => {
      const r = await agent({ instructions: 'Translate to German.' })
        .prompt(payload.summary);
      return next({ ...payload, translation: r.text });
    },
  ])
  .thenReturn();

console.log(result.translation);
```

## `Pipeline.send(payload)`

Creates a new pipeline instance with the given initial payload.

```ts
const pipeline = Pipeline.send({ x: 1, y: 2 });
```

## `.through(steps)`

Registers the pipeline steps. Steps are executed in array order.

```ts
pipeline.through([step1, step2, step3]);
```

## `.thenReturn()`

Executes the pipeline and returns a `Promise<T>` resolving to the final payload.

```ts
const result = await pipeline.thenReturn();
```

## Pipeline step signature

Each step is a function `(payload, next) => Promise<T>`:

```ts
const myStep: PipelineStep<MyPayload> = async (payload, next) => {
  // Do work
  const modified = { ...payload, field: newValue };
  // Call next() to continue, or return early to stop
  return next(modified);
};
```

## Early termination

A step can stop the pipeline by returning without calling `next()`:

```ts
async (payload, next) => {
  if (payload.qualityScore >= 9) {
    // Already meets the bar — skip remaining steps
    return payload;
  }
  return next(payload);
},
```

## Error handling

Errors thrown inside a step propagate normally. Wrap `thenReturn()` in try-catch:

```ts
try {
  const result = await Pipeline.send(payload).through(steps).thenReturn();
} catch (err) {
  console.error('Pipeline failed at step:', err);
}
```

To handle errors per step, wrap each step handler:

```ts
async (payload, next) => {
  try {
    const r = await agent({ instructions: '...' }).prompt(payload.text);
    return next({ ...payload, result: r.text });
  } catch {
    // Fall back to empty result and continue
    return next({ ...payload, result: '' });
  }
},
```

## Without Pipeline

`Pipeline` is a convenience wrapper. The equivalent without it:

```ts
let payload = { input: '...', summary: '', translation: '' };

const r1 = await agent({ instructions: 'Summarise.' }).prompt(payload.input);
payload = { ...payload, summary: r1.text };

const r2 = await agent({ instructions: 'Translate to German.' }).prompt(payload.summary);
payload = { ...payload, translation: r2.text };

console.log(payload.translation);
```

Both are equivalent — choose whichever is clearer for your team.
