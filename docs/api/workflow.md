# workflow()

A typed, multi-stage pipeline where parallel branches receive the same input and an AI step accumulates their results before passing to the next stage.

## When to use workflow vs other primitives

| | `workflow()` | `Pipeline` | `agent()` |
|---|---|---|---|
| **Control flow** | Code-defined stages | Code-defined steps | LLM-decided |
| **Parallel branches** | Yes — same input, AI accumulates | No | Via tools |
| **Output typing** | Full end-to-end inference | Single shared type | Text + optional structured |
| **Use for** | Multi-expert review, fan-out/fan-in | Sequential transforms | Autonomous reasoning |

---

## Functions

### `workflow()`

```ts
function workflow<T = unknown>(): WorkflowBuilder<T, T>
```

Create a workflow builder. Chain `.parallel()` and `.step()` calls to define stages, then call `.build()` to get a runner.

```ts
import { workflow, fromSkill, skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

const reviewSchema = z.object({ score: z.number(), feedback: z.string() });

const toneReviewer    = skill({ instructions: 'Review tone.',     output: reviewSchema });
const techReviewer    = skill({ instructions: 'Review accuracy.', output: reviewSchema });
const synthesizer     = skill({
  instructions: 'Synthesize multiple reviews into one report.',
  output: z.object({ summary: z.string(), avgScore: z.number() }),
});

const pipeline = workflow<{ title: string; body: string }>()
  .parallel({
    steps: [
      fromSkill('tone', toneReviewer),
      fromSkill('tech', techReviewer),
    ],
    accumulate: async (reviews) => (await synthesizer.invoke(reviews)).structured,
  })
  .build();

const { output, stages } = await pipeline.run({ title: 'My Post', body: '...' });
console.log(output.summary);
console.log(stages[0]!.durationMs); // parallel stage wall-clock time
```

---

### `fromSkill(name, runner)`

```ts
function fromSkill<TIn, TOut>(
  name: string,
  runner: SkillRunner<TIn, TOut>,
): WorkflowStep<TIn, TOut>
```

Adapt a `SkillRunner` to a `WorkflowStep`. Unwraps `result.structured` automatically so the step output is the typed value rather than the full `SkillResult` wrapper.

```ts
const toneStep = fromSkill('tone-reviewer', toneReviewer);
// toneStep.run(post) returns Promise<ReviewOutput> (not Promise<SkillResult<ReviewOutput>>)
```

---

### `parseWorkflow(content, registry)`

```ts
function parseWorkflow(content: string, registry: WorkflowRegistry): WorkflowRunner
```

Parse a workflow from a markdown string. Step names in frontmatter are resolved against `registry`. Throws at parse time if any name is missing.

---

### `loadWorkflow(filePath, registry)`

```ts
async function loadWorkflow(filePath: string, registry: WorkflowRegistry): Promise<WorkflowRunner>
```

Load a workflow from a markdown file.

---

## `WorkflowBuilder`

### `.parallel(config)`

```ts
parallel<TStepOut, TOut>(config: {
  steps: WorkflowStep<TCurrent, TStepOut>[];
  accumulate: (results: TStepOut[]) => Promise<TOut>;
}): WorkflowBuilder<TInitial, TOut>
```

Add a parallel stage. All `steps` receive the current input concurrently via `Promise.all`. `accumulate` receives the array of results and must return the next stage's input.

If any step rejects, the stage (and the entire workflow) fails immediately.

### `.step(step)`

```ts
step<TOut>(step: WorkflowStep<TCurrent, TOut>): WorkflowBuilder<TInitial, TOut>
```

Add a single serial step.

### `.branch(config)`

```ts
branch<TOut>(config: {
  name: string;
  select: (input: TCurrent) => string;
  cases: Record<string, WorkflowStep<TCurrent, TOut>>;
  default?: WorkflowStep<TCurrent, TOut>;
}): WorkflowBuilder<TInitial, TOut>
```

Add a routing stage. `select` extracts a string key from the current output; the matching entry in `cases` is executed. If no key matches and `default` is provided, it runs instead — otherwise an error is thrown.

All cases must return the same type `TOut`.

```ts
workflow<Request>()
  .step({ name: 'classify', run: classify })
  .branch({
    name: 'route',
    select: (req) => req.category,
    cases: {
      technical: fromSkill('tech',    techSkill),
      billing:   fromSkill('billing', billingSkill),
    },
    default: fromSkill('general', generalSkill),
  })
  .build();
```

### `.build()`

```ts
build(): WorkflowRunner<TInitial, TCurrent>
```

Compile the builder into an executable runner.

---

## Types

### `WorkflowStep`

```ts
interface WorkflowStep<TIn, TOut> {
  name: string;
  run: (input: TIn) => Promise<TOut>;
}
```

### `WorkflowResult`

```ts
interface WorkflowResult<TOut> {
  output: TOut;
  stages: StageResult[];
}
```

### `StageResult`

```ts
interface StageResult {
  type: 'parallel' | 'serial' | 'branch';
  /** Step name for serial/branch stages. */
  name?: string;
  /** Key selected — branch stages only. */
  selectedCase?: string;
  durationMs: number;
  /** true when restored from a checkpoint store instead of re-run. */
  resumed?: boolean;
}
```

### `WorkflowCheckpointStore`

```ts
interface WorkflowCheckpointStore {
  get(stageIndex: number): Promise<unknown | undefined>;
  set(stageIndex: number, output: unknown): Promise<void>;
}
```

### `WorkflowRunOptions`

```ts
interface WorkflowRunOptions {
  checkpointStore?: WorkflowCheckpointStore;
}
```

### `WorkflowRegistry`

```ts
type WorkflowRegistry = Record<string, WorkflowStep<unknown, unknown>>;
```

---

## Markdown format

```markdown
---
name: blog-review-pipeline
stages:
  - parallel:
      steps: [tone-reviewer, technical-reviewer, seo-reviewer]
      accumulate: review-synthesizer
  - step: final-editor
---

Three reviewers run in parallel. Their feedback is synthesized, then an editor
produces the final post.
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Workflow identifier. |
| `stages` | Yes | Ordered list of `parallel` or `step` entries. |
| `parallel.steps` | Yes | List of step names to run concurrently. |
| `parallel.accumulate` | Yes | Step name whose `run()` receives the results array. |
| `step` | Yes | Single step name (string). |
| Body | No | Description — not used at runtime. |

```ts
import { loadWorkflow, fromSkill, getSkill } from '@daedalus-ai-dev/ai-sdk';

// Build registry from registered skills
const registry = {
  'tone-reviewer':      fromSkill('tone-reviewer',      getSkill('tone-reviewer')),
  'technical-reviewer': fromSkill('technical-reviewer', getSkill('technical-reviewer')),
  'seo-reviewer':       fromSkill('seo-reviewer',       getSkill('seo-reviewer')),
  'review-synthesizer': fromSkill('review-synthesizer', getSkill('review-synthesizer')),
  'final-editor':       fromSkill('final-editor',       getSkill('final-editor')),
};

const pipeline = await loadWorkflow('./workflows/blog-review.md', registry);
const { output } = await pipeline.run(post);
```

::: tip Accumulator input
The `accumulate` step receives an **array** of the parallel step outputs, not a single value. Design the skill or function accordingly.
:::

::: warning Error handling
If any parallel step throws, the entire workflow fails. Wrap individual step `run` functions with try/catch if you need partial-result tolerance.
:::

---

## Checkpointing

Pass a `checkpointStore` to `run()` to enable resume-on-failure. Each stage's output is saved after it completes. On retry, stages with saved outputs are skipped (`resumed: true`) and execution continues from the first unsaved stage.

```ts
import { inMemoryCheckpointStore } from '@daedalus-ai-dev/ai-sdk';

const store = inMemoryCheckpointStore();

// First attempt — fails at stage 2
try {
  await pipeline.run(input, { checkpointStore: store });
} catch (e) {
  console.error('failed:', e);
}

// Retry — stage 1 is skipped, stage 2 is retried
const { output, stages } = await pipeline.run(input, { checkpointStore: store });
console.log(stages[0]?.resumed); // true — loaded from store
console.log(stages[1]?.resumed); // undefined — re-executed
```

`inMemoryCheckpointStore()` keeps outputs in a `Map` for the lifetime of the process. For cross-process or cross-restart resumption, provide a persistent store:

```ts
const store: WorkflowCheckpointStore = {
  async get(i) { return redis.get(`stage:${i}`).then(JSON.parse); },
  async set(i, v) { await redis.set(`stage:${i}`, JSON.stringify(v)); },
};
```
