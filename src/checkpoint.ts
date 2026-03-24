import type { AgentResponse, Checkpoint, InterruptedResponse } from './types.js';

// Re-export Checkpoint so callers can import it from either location.
export type { Checkpoint } from './types.js';

// ─── InterruptError ───────────────────────────────────────────────────────────

/**
 * Throw this inside a tool `handle` to pause the agent loop and surface a
 * question to the caller. The agent stops, returns an {@link InterruptedResponse}
 * containing a serialisable {@link Checkpoint}, and waits for the caller to
 * provide an answer via {@link AgentRunner.resume}.
 *
 * @example
 * ```ts
 * const askUser = defineTool({
 *   name: 'ask_user',
 *   schema: (s) => ({ question: s.string().required() }),
 *   handle: ({ question }) => {
 *     throw new InterruptError(question as string);
 *   },
 * });
 * ```
 */
export class InterruptError extends Error {
  constructor(public readonly question: string) {
    super(question);
    this.name = 'InterruptError';
  }
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

/**
 * Type guard — returns `true` when the result is an {@link InterruptedResponse}.
 *
 * @example
 * ```ts
 * const result = await agent(config).prompt('...');
 * if (isInterrupted(result)) {
 *   await kv.put(sessionId, JSON.stringify(result.checkpoint));
 *   return Response.json({ question: result.question });
 * }
 * console.log(result.text);
 * ```
 */
export function isInterrupted<T>(
  result: AgentResponse<T> | InterruptedResponse,
): result is InterruptedResponse {
  return 'interrupted' in result && result.interrupted === true;
}

/**
 * Narrow an agent result to {@link AgentResponse}, throwing if the agent was interrupted.
 * Use this when you know your tools never throw {@link InterruptError} and you want to
 * keep call sites concise.
 *
 * @example
 * ```ts
 * const response = assertComplete(await agent(config).prompt('Hello'));
 * console.log(response.text);
 * ```
 */
export function assertComplete<T>(
  result: AgentResponse<T> | InterruptedResponse,
): AgentResponse<T> {
  if (isInterrupted(result)) {
    throw new Error(`Agent interrupted: ${result.question}`);
  }
  return result;
}
