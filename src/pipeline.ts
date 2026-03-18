// ─── Pipeline (prompt chaining) ───────────────────────────────────────────────

export type PipelineStep<T> = (
  payload: T,
  next: (payload: T) => Promise<T>,
) => Promise<T>;

/**
 * A sequential pipeline for prompt chaining workflows.
 *
 * @example
 * const result = await Pipeline.send({ draft: '', review: null })
 *   .through([
 *     async (p, next) => next({ ...p, draft: await draftAgent(p) }),
 *     async (p, next) => next({ ...p, review: await reviewAgent(p) }),
 *   ])
 *   .thenReturn();
 */
export class Pipeline<T> {
  private steps: PipelineStep<T>[] = [];

  private constructor(private readonly initial: T) {}

  static send<T>(payload: T): Pipeline<T> {
    return new Pipeline(payload);
  }

  through(steps: PipelineStep<T>[]): this {
    this.steps = steps;
    return this;
  }

  thenReturn(): Promise<T> {
    const steps = this.steps;
    const initial = this.initial;

    const run = (index: number, payload: T): Promise<T> => {
      if (index >= steps.length) return Promise.resolve(payload);
      const step = steps[index];
      if (!step) return Promise.resolve(payload);
      return step(payload, (next) => run(index + 1, next));
    };

    return run(0, initial);
  }
}
