# Tools

Tools extend an agent's capabilities by letting the model call your code. When the model decides to use a tool, the SDK executes it, appends the result to the conversation, and continues the loop.

## Defining a tool

Use `defineTool()` for inline tools:

```ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';

const calculator = defineTool({
  name: 'calculator',
  description: 'Evaluate arithmetic expressions. Use for any math calculation.',
  schema: (s) => ({
    expression: s.string().description('e.g. "2 + 3 * 4"').required(),
  }),
  handle: (input) => {
    // In production use a safe math parser (never eval untrusted input)
    return String(eval(String(input.expression)));
  },
});
```

For reusable tools, implement the `Tool` interface as a class:

```ts
import type { Tool } from '@daedalus-ai-dev/ai-sdk';
import type { PropertyBuilder } from '@daedalus-ai-dev/ai-sdk';

class DatabaseLookup implements Tool {
  constructor(private readonly db: Database) {}

  name() { return 'database_lookup'; }

  description() {
    return 'Look up a record by ID from the application database.';
  }

  schema(s: SchemaBuilder): Record<string, PropertyBuilder> {
    return {
      table: s.enum(['users', 'orders', 'products']).required(),
      id:    s.string().description('Record UUID').required(),
    };
  }

  async handle(input: Record<string, unknown>): Promise<string> {
    const record = await this.db.findById(String(input.table), String(input.id));
    return JSON.stringify(record);
  }
}
```

## Attaching tools to an agent

Pass tools in the `tools` array:

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

const response = await agent({
  instructions: 'You are a data analyst. Use the database to answer questions.',
  tools: [new DatabaseLookup(db), new WebFetch()],
}).prompt('What is the email address of user with ID abc-123?');
```

## Writing good tool descriptions

The model decides *when* and *whether* to call a tool based solely on its `name` and `description`. Invest in these.

| ✅ Good | ❌ Avoid |
|---------|---------|
| Describe what the tool does and **when** to use it | Vague names like `tool1` or `helper` |
| List parameter meanings and expected formats | Ambiguous schemas with no descriptions |
| State what the tool returns | Omitting return value format |

**Example of a well-described tool:**

```ts
const webSearch = defineTool({
  name: 'web_search',
  description: `Search the web for current information. Use this when:
    - The user asks about recent events
    - You need facts you are not confident about
    - The question requires up-to-date data (prices, news, weather)
    Returns a list of search result snippets with URLs.`,
  schema: (s) => ({
    query: s.string()
      .description('A concise search query optimised for a search engine')
      .required(),
    maxResults: s.integer()
      .description('Number of results to return (1-10)')
      .min(1).max(10),
  }),
  handle: async (input) => { /* ... */ return ''; },
});
```

## Tool input schema

The `schema` function receives the [schema builder](./schema) and must return a `Record<string, PropertyBuilder>`. This is compiled to a JSON Schema object and sent to the model alongside the tool definition.

```ts
schema: (s) => ({
  // Required string with constraints
  name: s.string().minLength(1).maxLength(100).required(),

  // Optional integer with bounds
  limit: s.integer().min(1).max(1000),

  // Enum of allowed values
  format: s.enum(['json', 'csv', 'text']).required(),

  // Nested array of strings
  tags: s.array().items(s.string().toSchema()),

  // Boolean flag
  includeMetadata: s.boolean(),
})
```

## Tool handle return value

`handle` must return a `string` (or `Promise<string>`). The model receives this string as the tool result. If you have structured data, serialize it:

```ts
handle: async (input) => {
  const data = await fetchSomething(input);
  return JSON.stringify(data, null, 2);
}
```

## Error handling in tools

If `handle` throws, the SDK catches the error and sends it back to the model as a tool error result. The model can then decide how to recover or inform the user.

```ts
handle: async (input) => {
  const id = String(input.id);
  if (!isValidUUID(id)) {
    throw new Error(`Invalid UUID: ${id}`); // Model will see this error
  }
  return await db.findById(id);
}
```

## Built-in tools

The SDK ships with a `WebFetch` tool:

```ts
import { WebFetch } from '@daedalus-ai-dev/ai-sdk';

const response = await agent({
  instructions: 'You summarize web pages.',
  tools: [new WebFetch()],
}).prompt('What does https://example.com say?');
```

`WebFetch` fetches the URL and returns the first 10,000 characters of the response body. It sets a `User-Agent` header identifying the SDK.

## Agent-as-tool (Orchestrator-Workers)

A powerful pattern is to wrap an `agent()` call inside a tool, creating sub-agents that the orchestrator can delegate to:

```ts
const codeWriterTool = defineTool({
  name: 'write_code',
  description: 'Delegate code writing to a specialist agent.',
  schema: (s) => ({
    filePath: s.string().description('Path of the file to create').required(),
    purpose:  s.string().description('What this file should do').required(),
  }),
  handle: async (input) => {
    const r = await agent({
      instructions: 'You are an expert TypeScript developer.',
    }).prompt(`Create ${input.filePath} to: ${input.purpose}`);
    return r.text;
  },
});

// Orchestrator uses the tool
const response = await agent({
  instructions: 'You are a software architect. Delegate implementation to workers.',
  tools: [codeWriterTool],
}).prompt('Implement a REST API endpoint for user registration.');
```

See [Orchestrator-Workers →](../patterns/orchestrator-workers) for the full pattern.
