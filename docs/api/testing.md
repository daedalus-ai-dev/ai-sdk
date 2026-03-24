# Testing Utilities

Test your agent logic without hitting real APIs.

Import from the dedicated subpath so the utilities are never included in production bundles:

```ts
import { mockProvider, mockTool, toolUseResponse } from '@daedalus-ai-dev/ai-sdk/testing';
```

## `mockProvider(responses)`

Creates a mock [`AIProvider`](/api/agent#aiprovider) that returns pre-defined responses instead of calling an LLM.

```ts
const provider = mockProvider([
  'Hello!',                                       // plain string → text/end_turn
  toolUseResponse('search', { query: 'TS' }),     // simulates a tool call
  'Here are the results.',                        // follow-up after tool
]);
```

**Responses are consumed in order.** If there are more calls than entries, the last entry repeats.

Access `provider.calls` to assert what requests were sent:

```ts
expect(provider.calls).toHaveLength(2);
expect(provider.calls[0].messages[0].content).toBe('What is TypeScript?');
```

### Signature

```ts
function mockProvider(responses: MockResponse[]): MockProviderInstance

type MockResponse =
  | string
  | (Partial<Omit<ChatResponse, 'content'>> & { content?: MessageContent[] | string })

interface MockProviderInstance extends AIProvider {
  readonly calls: ChatRequest[];
}
```

### Response formats

| Format | When to use |
|--------|-------------|
| `'text string'` | Simple text response, `end_turn` |
| `{ content: 'text' }` | Text response with custom usage or stopReason |
| `{ content: [...] }` | Full `MessageContent[]` array |
| `toolUseResponse(...)` | Simulate a tool call |

## `toolUseResponse(name, input, options?)`

Builds a `tool_use` response entry for use in a `mockProvider` sequence.

```ts
const provider = mockProvider([
  toolUseResponse('calculator', { a: 3, b: 4 }),
  'The answer is 7.',
]);
```

### Signature

```ts
function toolUseResponse(
  name: string,
  input: Record<string, unknown>,
  options?: {
    id?: string;
    usage?: { inputTokens: number; outputTokens: number };
  },
): MockResponse
```

## `mockTool(name, handler)`

Creates a mock [`Tool`](/api/define-tool) that records every input it receives.

```ts
const search = mockTool('search', ({ query }) => `Results for: ${query}`);
const fixed  = mockTool('lookup', 'static result');
```

Access `tool.calls` after the agent runs:

```ts
expect(search.calls).toHaveLength(1);
expect(search.calls[0]).toEqual({ query: 'TypeScript' });
```

### Signature

```ts
function mockTool(
  name: string,
  handler: string | ((input: Record<string, unknown>) => string | Promise<string>),
): MockToolInstance

interface MockToolInstance extends Tool {
  readonly calls: Record<string, unknown>[];
}
```

## Full example

```ts
import { describe, expect, it } from 'vitest';
import { agent } from '@daedalus-ai-dev/ai-sdk';
import { assertComplete } from '@daedalus-ai-dev/ai-sdk';
import { mockProvider, mockTool, toolUseResponse } from '@daedalus-ai-dev/ai-sdk/testing';

describe('my agent', () => {
  it('calls the calculator tool and returns the result', async () => {
    const calculator = mockTool('add', ({ a, b }) => String(Number(a) + Number(b)));

    const provider = mockProvider([
      toolUseResponse('add', { a: 3, b: 4 }),
      'The answer is 7.',
    ]);

    const result = assertComplete(
      await agent({
        instructions: 'Use the calculator.',
        tools: [calculator],
        provider,
      }).prompt('What is 3 + 4?'),
    );

    expect(result.text).toBe('The answer is 7.');
    expect(calculator.calls).toHaveLength(1);
    expect(calculator.calls[0]).toEqual({ a: 3, b: 4 });
    expect(provider.calls).toHaveLength(2);
  });
});
```
