import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import type { SkillRunner } from './skill.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep<TIn, TOut> {
  name: string;
  run: (input: TIn) => Promise<TOut>;
}

export interface StageResult {
  type: 'parallel' | 'serial';
  /** Step name for serial stages. Undefined for parallel stages. */
  name?: string;
  durationMs: number;
}

export interface WorkflowResult<TOut> {
  output: TOut;
  stages: StageResult[];
}

export interface WorkflowRunner<TIn = unknown, TOut = unknown> {
  run(input: TIn): Promise<WorkflowResult<TOut>>;
}

// ─── Internal stage representation ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStage = ParallelStage<any, any, any> | SerialStage<any, any>;

interface ParallelStage<TIn, TStepOut, TOut> {
  kind: 'parallel';
  steps: WorkflowStep<TIn, TStepOut>[];
  accumulate: (results: TStepOut[]) => Promise<TOut>;
}

interface SerialStage<TIn, TOut> {
  kind: 'serial';
  step: WorkflowStep<TIn, TOut>;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Fluent builder for typed, multi-stage workflows.
 *
 * Each `.parallel()` or `.step()` call appends a stage and shifts the
 * current output type, so the chain is fully type-safe end-to-end.
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
    return new WorkflowBuilder<TInitial, TOut>([
      ...this._stages,
      { kind: 'serial', step },
    ]);
  }

  /** Compile the builder into an executable runner. */
  build(): WorkflowRunner<TInitial, TCurrent> {
    const stages = [...this._stages];
    return {
      async run(input: TInitial): Promise<WorkflowResult<TCurrent>> {
        let current: unknown = input;
        const stageResults: StageResult[] = [];

        for (const stage of stages) {
          const start = Date.now();

          if (stage.kind === 'parallel') {
            const results = await Promise.all(
              stage.steps.map((s: WorkflowStep<unknown, unknown>) => s.run(current)),
            );
            current = await stage.accumulate(results);
            stageResults.push({ type: 'parallel', durationMs: Date.now() - start });
          } else {
            current = await stage.step.run(current);
            stageResults.push({ type: 'serial', name: stage.step.name, durationMs: Date.now() - start });
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
 * Create a typed, multi-stage workflow with parallel and serial stages.
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

  const name = data['name'] as string | undefined;
  if (!name) throw new Error('Workflow markdown must have a "name" field in frontmatter.');

  const rawStages = data['stages'] as RawStage[] | undefined;
  if (!rawStages || !Array.isArray(rawStages) || rawStages.length === 0) {
    throw new Error(`Workflow "${name}" must define at least one stage in frontmatter.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
