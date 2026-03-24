import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import * as log from './logger.js';
import type { SkillRunner } from './skill.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep<TIn, TOut> {
  name: string;
  run: (input: TIn) => Promise<TOut>;
}

export interface StageResult {
  type: 'parallel' | 'serial' | 'branch';
  /** Step name for serial/branch stages. Undefined for parallel stages. */
  name?: string;
  /** For branch stages: the key that was selected. */
  selectedCase?: string;
  durationMs: number;
  /** `true` when the stage output was restored from a checkpoint store. */
  resumed?: boolean;
}

export interface WorkflowResult<TOut> {
  output: TOut;
  stages: StageResult[];
}

// ─── Checkpoint store ─────────────────────────────────────────────────────────

/**
 * Persistence interface for workflow stage outputs.
 * Pass to `runner.run(input, { checkpointStore })` to enable resume-on-failure.
 */
export interface WorkflowCheckpointStore {
  get(stageIndex: number): Promise<unknown | undefined>;
  set(stageIndex: number, output: unknown): Promise<void>;
}

/**
 * Create a simple in-memory checkpoint store.
 *
 * Suitable for resuming a workflow within the same process. For cross-process
 * or cross-restart resumption, provide a persistent store backed by a database
 * or file system.
 */
export function inMemoryCheckpointStore(): WorkflowCheckpointStore {
  const map = new Map<number, unknown>();
  return {
    async get(i) {
      return map.get(i);
    },
    async set(i, v) {
      map.set(i, v);
    },
  };
}

export interface WorkflowRunOptions {
  /**
   * Checkpoint store to use for this run.
   * Stages whose outputs are already stored will be skipped (`resumed: true`).
   * On successful completion of each stage, the output is saved.
   */
  checkpointStore?: WorkflowCheckpointStore;
}

export interface WorkflowRunner<TIn = unknown, TOut = unknown> {
  run(input: TIn, options?: WorkflowRunOptions): Promise<WorkflowResult<TOut>>;
}

// ─── Internal stage representation ────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: third-party type boundary
type AnyStage = ParallelStage<any, any, any> | SerialStage<any, any> | BranchStage<any, any>;

interface ParallelStage<TIn, TStepOut, TOut> {
  kind: 'parallel';
  steps: WorkflowStep<TIn, TStepOut>[];
  accumulate: (results: TStepOut[]) => Promise<TOut>;
}

interface SerialStage<TIn, TOut> {
  kind: 'serial';
  step: WorkflowStep<TIn, TOut>;
}

interface BranchStage<TIn, TOut> {
  kind: 'branch';
  name: string;
  select: (input: TIn) => string;
  cases: Record<string, WorkflowStep<TIn, TOut>>;
  default?: WorkflowStep<TIn, TOut>;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Fluent builder for typed, multi-stage workflows.
 *
 * Each `.parallel()`, `.step()`, or `.branch()` call appends a stage and
 * shifts the current output type, so the chain is fully type-safe end-to-end.
 */
export class WorkflowBuilder<TInitial, TCurrent> {
  private constructor(private readonly _stages: AnyStage[]) {}

  /** @internal */
  static create<T>(): WorkflowBuilder<T, T> {
    return new WorkflowBuilder<T, T>([]);
  }

  /**
   * Add a parallel stage.
   *
   * All `steps` receive the same input (`TCurrent`) and produce `TStepOut`.
   * `accumulate` merges the array of results into `TOut` before the next stage.
   *
   * Steps run concurrently via `Promise.all`. If any step rejects, the stage
   * (and the whole workflow) fails immediately.
   */
  parallel<TStepOut, TOut>(config: {
    steps: WorkflowStep<TCurrent, TStepOut>[];
    accumulate: (results: TStepOut[]) => Promise<TOut>;
  }): WorkflowBuilder<TInitial, TOut> {
    return new WorkflowBuilder<TInitial, TOut>([
      ...this._stages,
      { kind: 'parallel', steps: config.steps, accumulate: config.accumulate },
    ]);
  }

  /**
   * Add a single serial step.
   *
   * The step receives the output of the previous stage and produces `TOut`.
   */
  step<TOut>(step: WorkflowStep<TCurrent, TOut>): WorkflowBuilder<TInitial, TOut> {
    return new WorkflowBuilder<TInitial, TOut>([...this._stages, { kind: 'serial', step }]);
  }

  /**
   * Add a branch (routing) stage.
   *
   * `select` extracts a string key from the current output. The matching entry
   * in `cases` is executed. If no case matches and `default` is provided, it is
   * used; otherwise an error is thrown.
   *
   * All cases must return the same type `TOut`.
   *
   * ```ts
   * workflow<Request>()
   *   .step({ name: 'classify', run: classify })
   *   .branch({
   *     name: 'route',
   *     select: (r) => r.category,
   *     cases: {
   *       technical: fromSkill('tech', techSkill),
   *       billing:   fromSkill('billing', billingSkill),
   *     },
   *     default: fromSkill('general', generalSkill),
   *   })
   *   .build();
   * ```
   */
  branch<TOut>(config: {
    name: string;
    select: (input: TCurrent) => string;
    cases: Record<string, WorkflowStep<TCurrent, TOut>>;
    default?: WorkflowStep<TCurrent, TOut>;
  }): WorkflowBuilder<TInitial, TOut> {
    return new WorkflowBuilder<TInitial, TOut>([
      ...this._stages,
      {
        kind: 'branch',
        name: config.name,
        select: config.select,
        cases: config.cases,
        default: config.default,
      },
    ]);
  }

  /** Compile the builder into an executable runner. */
  build(): WorkflowRunner<TInitial, TCurrent> {
    const stages = [...this._stages];
    return {
      async run(input: TInitial, options?: WorkflowRunOptions): Promise<WorkflowResult<TCurrent>> {
        let current: unknown = input;
        const stageResults: StageResult[] = [];
        const store = options?.checkpointStore;

        for (let i = 0; i < stages.length; i++) {
          // ── Checkpoint resume ────────────────────────────────────────────────
          if (store) {
            const saved = await store.get(i);
            if (saved !== undefined) {
              current = saved;
              const stage = stages[i];
              // biome-ignore lint/style/noNonNullAssertion: i is within bounds
              const name =
                stage!.kind === 'serial'
                  ? stage!.step.name
                  : stage!.kind === 'branch'
                    ? stage!.name
                    : undefined;
              // biome-ignore lint/style/noNonNullAssertion: i is within bounds
              stageResults.push({ type: stage!.kind, name, durationMs: 0, resumed: true });
              continue;
            }
          }

          const stage = stages[i];
          // biome-ignore lint/style/noNonNullAssertion: i is within bounds
          const s = stage!;
          const start = Date.now();

          if (s.kind === 'parallel') {
            const stepNames = s.steps.map((st: WorkflowStep<unknown, unknown>) => st.name);
            log.workflowStageStart('parallel', stepNames);
            const results = await Promise.all(
              s.steps.map((st: WorkflowStep<unknown, unknown>) => st.run(current)),
            );
            current = await s.accumulate(results);
            const elapsed = Date.now() - start;
            stageResults.push({ type: 'parallel', durationMs: elapsed });
            log.workflowStageDone(elapsed);
          } else if (s.kind === 'serial') {
            log.workflowStageStart('serial', [s.step.name]);
            current = await s.step.run(current);
            const elapsed = Date.now() - start;
            stageResults.push({ type: 'serial', name: s.step.name, durationMs: elapsed });
            log.workflowStageDone(elapsed);
          } else {
            // branch
            const key = s.select(current);
            const handler = s.cases[key] ?? s.default;
            if (!handler) {
              throw new Error(
                `Workflow branch "${s.name}": no case for key "${key}" and no default defined.`,
              );
            }
            log.workflowStageStart('branch', [s.name, key]);
            current = await handler.run(current);
            const elapsed = Date.now() - start;
            stageResults.push({
              type: 'branch',
              name: s.name,
              selectedCase: key,
              durationMs: elapsed,
            });
            log.workflowStageDone(elapsed);
          }

          // ── Checkpoint save ──────────────────────────────────────────────────
          if (store) {
            await store.set(i, current);
          }
        }

        return {
          output: current as TCurrent,
          stages: stageResults,
        };
      },
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a typed, multi-stage workflow with parallel, serial, and branch stages.
 *
 * @example
 * const pipeline = workflow<Post>()
 *   .parallel({
 *     steps: [toneStep, techStep, seoStep],
 *     accumulate: async (reviews) => (await synthesizer.invoke(reviews)).structured,
 *   })
 *   .step({ name: 'editor', run: async (report) => (await editor.invoke(report)).structured })
 *   .build();
 *
 * const { output, stages } = await pipeline.run(post);
 */
export function workflow<T = unknown>(): WorkflowBuilder<T, T> {
  return WorkflowBuilder.create<T>();
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Wrap a `SkillRunner` as a `WorkflowStep`.
 *
 * Extracts `result.structured` automatically so the step output is the typed
 * value rather than the full `SkillResult` wrapper.
 *
 * @example
 * const toneStep = fromSkill('tone-reviewer', toneReviewer);
 */
export function fromSkill<TIn, TOut>(
  name: string,
  runner: SkillRunner<TIn, TOut>,
): WorkflowStep<TIn, TOut> {
  return {
    name,
    run: async (input) => (await runner.invoke(input)).structured,
  };
}

// ─── Markdown loading ─────────────────────────────────────────────────────────

/** Step registry used when loading workflows from markdown. */
export type WorkflowRegistry = Record<string, WorkflowStep<unknown, unknown>>;

interface RawParallelStage {
  parallel: {
    steps: string[];
    accumulate: string;
  };
}

interface RawSerialStage {
  step: string;
}

type RawStage = RawParallelStage | RawSerialStage;

function isParallelStage(s: RawStage): s is RawParallelStage {
  return 'parallel' in s;
}

function resolveStep(name: string, registry: WorkflowRegistry): WorkflowStep<unknown, unknown> {
  const entry = registry[name];
  if (!entry) {
    throw new Error(
      `Workflow step "${name}" not found in registry. Register it before calling parseWorkflow().`,
    );
  }
  return entry;
}

/**
 * Parse a workflow from markdown string content and return a runner.
 *
 * Step names in the `stages` frontmatter are resolved against `registry`.
 *
 * @example
 * ```markdown
 * ---
 * name: blog-review-pipeline
 * stages:
 *   - parallel:
 *       steps: [tone-reviewer, technical-reviewer, seo-reviewer]
 *       accumulate: review-synthesizer
 *   - step: final-editor
 * ---
 * Runs three reviewers in parallel, synthesizes feedback, then edits.
 * ```
 */
export function parseWorkflow(content: string, registry: WorkflowRegistry): WorkflowRunner {
  const { data } = matter(content);

  const name = data.name as string | undefined;
  if (!name) throw new Error('Workflow markdown must have a "name" field in frontmatter.');

  const rawStages = data.stages as RawStage[] | undefined;
  if (!rawStages || !Array.isArray(rawStages) || rawStages.length === 0) {
    throw new Error(`Workflow "${name}" must define at least one stage in frontmatter.`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: third-party type boundary
  let builder: WorkflowBuilder<any, any> = WorkflowBuilder.create<unknown>();

  for (const raw of rawStages) {
    if (isParallelStage(raw)) {
      const { steps: stepNames, accumulate: accName } = raw.parallel;
      const steps = stepNames.map((n) => resolveStep(n, registry));
      const acc = resolveStep(accName, registry);
      builder = builder.parallel({
        steps,
        accumulate: (results) => acc.run(results),
      });
    } else {
      const step = resolveStep(raw.step, registry);
      builder = builder.step(step);
    }
  }

  return builder.build();
}

/**
 * Load a workflow from a markdown file.
 */
export async function loadWorkflow(
  filePath: string,
  registry: WorkflowRegistry,
): Promise<WorkflowRunner> {
  const content = await readFile(filePath, 'utf-8');
  return parseWorkflow(content, registry);
}
