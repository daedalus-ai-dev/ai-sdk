import type { Tool } from './tool.js';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  MessageContent,
  StreamChunk,
} from './types.js';

// ─── Response helpers ─────────────────────────────────────────────────────────

/**
 * A response entry for {@link mockProvider}.
 *
 * - Pass a plain `string` for a simple text/end_turn response.
 * - Pass a partial {@link ChatResponse} (with an optional string `content` shorthand) for full control.
 * - Use {@link toolUseResponse} to build a tool-call response.
 */
export type MockResponse =
  | string
  | (Partial<Omit<ChatResponse, 'content'>> & { content?: MessageContent[] | string });

function buildResponse(r: MockResponse): ChatResponse {
  if (typeof r === 'string') {
    return {
      id: 'mock-id',
      content: [{ type: 'text', text: r }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  const content =
    typeof r.content === 'string'
      ? [{ type: 'text' as const, text: r.content }]
      : (r.content ?? [{ type: 'text', text: '' }]);
  return {
    id: r.id ?? 'mock-id',
    content,
    stopReason: r.stopReason ?? 'end_turn',
    usage: r.usage ?? { inputTokens: 10, outputTokens: 10 },
  };
}

/**
 * Build a `tool_use` response for use inside a {@link mockProvider} sequence.
 * Simulates the model requesting a tool call.
 *
 * ```ts
 * const provider = mockProvider([
 *   toolUseResponse('calculator', { a: 2, b: 3 }),
 *   'The answer is 5.',
 * ]);
 * ```
 */
export function toolUseResponse(
  name: string,
  input: Record<string, unknown>,
  options?: { id?: string; usage?: { inputTokens: number; outputTokens: number } },
): MockResponse {
  return {
    content: [{ type: 'tool_use', id: options?.id ?? `tool-use-${name}`, name, input }],
    stopReason: 'tool_use',
    usage: options?.usage,
  };
}

// ─── MockProvider ─────────────────────────────────────────────────────────────

/** A mock {@link AIProvider} that records every request it receives. */
export interface MockProviderInstance extends AIProvider {
  /** All {@link ChatRequest}s received, in call order. */
  readonly calls: ChatRequest[];
}

/**
 * Create a mock {@link AIProvider} for unit-testing agent logic without hitting
 * a real API.
 *
 * Responses are consumed in order. If there are more calls than entries, the
 * last entry repeats indefinitely.
 *
 * ```ts
 * const provider = mockProvider([
 *   'Hello!',
 *   toolUseResponse('search', { query: 'TypeScript' }),
 *   'Here are the results.',
 * ]);
 *
 * const result = assertComplete(await agent({ instructions: '...', provider }).prompt('Hi'));
 * expect(provider.calls).toHaveLength(1);
 * ```
 */
export function mockProvider(responses: MockResponse[]): MockProviderInstance {
  if (responses.length === 0) throw new Error('mockProvider requires at least one response');
  const calls: ChatRequest[] = [];
  let index = 0;

  return {
    calls,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      // biome-ignore lint/style/noNonNullAssertion: length checked above; fallback is always defined
      const r = responses[index] ?? responses[responses.length - 1]!;
      index++;
      return buildResponse(r);
    },
    async *stream(): AsyncGenerator<StreamChunk> {
      // no-op — override with a custom provider if streaming tests are needed
    },
  };
}

// ─── MockTool ─────────────────────────────────────────────────────────────────

/** A mock {@link Tool} that records every input it receives. */
export interface MockToolInstance extends Tool {
  /** All inputs passed to this tool, in call order. */
  readonly calls: Record<string, unknown>[];
}

/**
 * Create a mock {@link Tool} for unit-testing tool-call flows without real
 * side effects.
 *
 * Pass a string for a fixed return value, or a function for dynamic responses.
 * Inspect `tool.calls` to assert what the model sent.
 *
 * ```ts
 * const search = mockTool('search', ({ query }) => `Results for: ${query}`);
 * const fixed  = mockTool('lookup', 'static result');
 *
 * // after running agent:
 * expect(search.calls).toHaveLength(1);
 * expect(search.calls[0]).toEqual({ query: 'TypeScript' });
 * ```
 */
export function mockTool(
  name: string,
  handler: string | ((input: Record<string, unknown>) => string | Promise<string>),
): MockToolInstance {
  const calls: Record<string, unknown>[] = [];
  const fn = typeof handler === 'string' ? () => handler : handler;

  return {
    calls,
    name: () => name,
    description: () => `Mock tool: ${name}`,
    schema: () => ({}),
    async handle(input: Record<string, unknown>): Promise<string> {
      calls.push(input);
      return fn(input);
    },
  };
}
