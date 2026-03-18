# `defineTool(options)`

Creates a `Tool` from a plain options object. Use this for inline or one-off tools.

## Signature

```ts
function defineTool(options: {
  name: string;
  description: string;
  schema: SchemaFn;
  handle: (input: Record<string, unknown>) => Promise<string> | string;
}): Tool
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique identifier for the tool (snake_case recommended) |
| `description` | `string` | Tells the model when and how to use this tool |
| `schema` | `SchemaFn` | Defines the tool's input parameters |
| `handle` | `function` | Executes the tool and returns a string result |

## Example

```ts
import { defineTool } from '@rokkhopper/ai-sdk';

const getExchangeRate = defineTool({
  name: 'get_exchange_rate',
  description: 'Get the current exchange rate between two currencies. Use for any currency conversion question.',
  schema: (s) => ({
    from: s.string().description('Source currency code, e.g. USD').required(),
    to:   s.string().description('Target currency code, e.g. EUR').required(),
  }),
  handle: async (input) => {
    const rate = await fetchExchangeRate(String(input.from), String(input.to));
    return `1 ${input.from} = ${rate} ${input.to}`;
  },
});
```

## The `Tool` interface

For class-based tools, implement `Tool` directly:

```ts
import type { Tool } from '@rokkhopper/ai-sdk';
import type { SchemaBuilder, PropertyBuilder } from '@rokkhopper/ai-sdk';

class DatabaseSearch implements Tool {
  constructor(private readonly connection: DbConnection) {}

  name() { return 'database_search'; }

  description() {
    return 'Search the database for records matching a query. Returns up to 10 results as JSON.';
  }

  schema(s: SchemaBuilder): Record<string, PropertyBuilder> {
    return {
      table:  s.enum(['users', 'orders', 'products']).required(),
      query:  s.string().description('Search term').required(),
      limit:  s.integer().min(1).max(10),
    };
  }

  async handle(input: Record<string, unknown>): Promise<string> {
    const results = await this.connection.search(
      String(input.table),
      String(input.query),
      Number(input.limit ?? 5),
    );
    return JSON.stringify(results, null, 2);
  }
}
```

## Input types

`handle` receives `Record<string, unknown>`. Cast values explicitly:

```ts
handle: (input) => {
  const name = String(input.name);       // string cast
  const age  = Number(input.age);        // number cast
  const tags = input.tags as string[];   // array cast

  // ...
}
```

::: warning
Always validate and cast input — the model may send unexpected values even if the schema constrains them.
:::

## Async tools

`handle` can return a `Promise<string>`:

```ts
handle: async (input) => {
  const result = await fetch(`https://api.example.com/${input.id}`);
  const json = await result.json();
  return JSON.stringify(json);
},
```

## Error handling

Throw an error to signal failure. The SDK catches it and sends it to the model as a tool error:

```ts
handle: async (input) => {
  const id = String(input.id);
  const record = await db.find(id);

  if (!record) {
    throw new Error(`No record found with ID: ${id}`);
    // The model receives: "Tool error: No record found with ID: xyz"
    // and can decide how to respond to the user
  }

  return JSON.stringify(record);
},
```
