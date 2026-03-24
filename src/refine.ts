// ─── Types ────────────────────────────────────────────────────────────────────

export interface RefineResult<TOutput> {
  /** The final output as returned by `until()`. */
  output: TOutput;
  /** Number of `step` calls that ran before the condition was met. */
  iterations: number;
}

export interface RefineConfig<TState, TOutput> {
  /** Initial state passed to the first `step` call. */
  state: TState;
  /**
   * Work function. Receives the current state and the 1-based iteration number.
   * Returns the next state.
   */
  step: (state: TState, iteration: number) => Promise<TState>;
  /**
   * Exit condition. Called after every `step` with the new state and the
   * previous state (the initial state on the first iteration).
   *
   * Use `previous` to detect stalled progress — e.g. if nothing changed,
   * bail out rather than burning more LLM calls.
   *
   * Return `{ done: true, output }` to stop, or `{ done: false }` to continue.
   */
  until: (
    current: TState,
    previous: TState,
  ) => { done: true; output: TOutput } | { done: false };
  /**
   * Hard ceiling on the number of iterations.
   * Throws `RefineLimitError` if exceeded.
   * @default 10
   */
  maxIterations?: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class RefineLimitError extends Error {
  constructor(
    public readonly maxIterations: number,
    public readonly lastState: unknown,
  ) {
    super(
      `refine() reached maxIterations (${maxIterations}) without the until() condition being met.`,
    );
    this.name = 'RefineLimitError';
  }
}

// ─── refine() ─────────────────────────────────────────────────────────────────

/**
 * Run an iterative refinement loop — the evaluator-optimizer pattern.
 *
 * Calls `step` repeatedly, passing current state through each iteration.
 * After each step, `until` decides whether to stop. `until` receives both
 * the new state and the previous state so you can detect stalled progress.
 *
 * Throws `RefineLimitError` if `maxIterations` is reached without `until`
 * returning `{ done: true }`.
 *
 * @example
 * // TDD: implement until tests pass
 * const { output: code, iterations } = await refine({
 *   state: { spec, code: '', errors: [] as string[] },
 *   step: async (s) => {
 *     const { code } = await implementer.invoke({ spec: s.spec, errors: s.errors });
 *     const { errors } = await testRunner.invoke(code);
 *     return { ...s, code, errors };
 *   },
 *   until: (curr, prev) => {
 *     if (curr.errors.length === 0) return { done: true, output: curr.code };
 *     if (curr.code === prev.code)  return { done: true, output: curr.code }; // no progress
 *     return { done: false };
 *   },
 *   maxIterations: 5,
 * });
 */
export async function refine<TState, TOutput>(
  config: RefineConfig<TState, TOutput>,
): Promise<RefineResult<TOutput>> {
  const { step, until, maxIterations = 10 } = config;
  let current = config.state;

  for (let i = 0; i < maxIterations; i++) {
    const previous = current;
    current = await step(current, i + 1);

    const check = until(current, previous);
    if (check.done) {
      return { output: check.output, iterations: i + 1 };
    }
  }

  throw new RefineLimitError(maxIterations, current);
}
