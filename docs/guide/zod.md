# Zod Schema Support

You can pass a Zod schema anywhere the SDK accepts a schema — `agent({ schema })` and `defineTool({ schema })`.

## Setup

Install the two peer dependencies:

```sh
npm install zod zod-to-json-schema
```

## Structured output with Zod

Define your output type once and reuse it for both schema generation and TypeScript inference:

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

const Review = z.object({
  score:    z.number().int().min(1).max(10),
  approved: z.boolean(),
  issues:   z.array(z.string()),
});

const response = await agent({
  instructions: 'Evaluate the content.',
  schema: Review,
}).prompt<z.infer<typeof Review>>('Rate: "The quick brown fox."');

// response.structured is fully typed as z.infer<typeof Review>
console.log(response.structured.score);    // 7
console.log(response.structured.approved); // false
console.log(response.structured.issues);   // ["Too short", ...]
```

::: tip Required fields
With Zod, all fields are **automatically required** unless you mark them `.optional()`. This avoids the common pitfall with the fluent builder where forgetting `.required()` causes fields to be missing from the response.
:::

## Tool schemas with Zod

Reuse existing Zod schemas instead of redeclaring them with the fluent builder:

```ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

// Existing schema from your validation layer
const SearchInput = z.object({
  query:  z.string().describe('Search query'),
  limit:  z.number().int().min(1).max(50).default(10).optional(),
});

const searchTool = defineTool({
  name: 'search',
  description: 'Search the knowledge base.',
  schema: SearchInput,
  handle: async (input) => {
    const results = await db.search(String(input.query), Number(input.limit ?? 10));
    return JSON.stringify(results);
  },
});
```

## Comparison

| | Fluent builder | Zod schema |
|---|---|---|
| Required fields | Must call `.required()` explicitly | Required by default (`.optional()` to opt out) |
| TypeScript types | Inferred from generic `T` at call site | `z.infer<typeof Schema>` — reuse existing types |
| Reuse existing schemas | No | Yes |
| Zero extra dependencies | Yes | Requires `zod` + `zod-to-json-schema` |

Both approaches are fully supported and can be mixed within the same project.
