# Schema Builder

The schema builder provides a fluent API for defining JSON Schema objects. It is used in two places:

1. **Structured output** — tell the model to return validated JSON
2. **Tool input schema** — define what parameters a tool accepts

## Basic usage

```ts
import { agent } from '@rokkhopper/ai-sdk';

const response = await agent({
  instructions: 'Extract product details from the text.',
  schema: (s) => ({
    name:     s.string().required(),
    price:    s.number().min(0).required(),
    inStock:  s.boolean().required(),
    tags:     s.array().items(s.string().toSchema()),
  }),
}).prompt<{ name: string; price: number; inStock: boolean; tags: string[] }>(
  'Product: "Blue Widget — $12.99, available, tags: widget, blue"'
);

console.log(response.structured);
// { name: 'Blue Widget', price: 12.99, inStock: true, tags: ['widget', 'blue'] }
```

## Property types

### `s.string()`

```ts
s.string()
  .description('Human-readable description for the model')
  .minLength(1)
  .maxLength(500)
  .pattern('^[a-z]+$')  // regex pattern
  .required()
```

### `s.integer()`

```ts
s.integer()
  .description('A whole number')
  .min(0)
  .max(100)
  .required()
```

### `s.number()`

```ts
s.number()
  .description('A decimal number')
  .min(0.0)
  .max(1.0)
  .required()
```

### `s.boolean()`

```ts
s.boolean()
  .description('true or false')
  .required()
```

### `s.enum(values)`

```ts
s.enum(['pending', 'active', 'cancelled'])
  .description('Current status of the order')
  .required()
```

### `s.array()`

```ts
s.array()
  .description('List of tags')
  .items(s.string().toSchema())  // Note: call .toSchema() on nested builders
  .required()
```

::: warning Nested builders
When passing a builder as `.items()`, call `.toSchema()` on it to convert it to a plain JSON Schema object. This is because `.items()` accepts a `JsonSchemaProperty`, not a builder.

```ts
// ✅ Correct
s.array().items(s.string().toSchema())

// ❌ Wrong — passes a builder object, not a schema
s.array().items(s.string())
```
:::

## The `required()` modifier

Call `.required()` on any property to mark it as required in the output schema. Properties without `.required()` are optional.

```ts
schema: (s) => ({
  title:    s.string().required(),  // included in "required" array
  subtitle: s.string(),             // optional — model may omit it
})
```

## Descriptions

Add `.description()` to give the model context about what each field means. This significantly improves extraction accuracy for structured output.

```ts
schema: (s) => ({
  sentiment: s.enum(['positive', 'neutral', 'negative'])
    .description('Overall emotional tone of the text')
    .required(),
  confidence: s.number().min(0).max(1)
    .description('Model confidence from 0.0 (uncertain) to 1.0 (certain)')
    .required(),
})
```

## Using `buildSchema()` directly

You can also call `buildSchema()` to get a raw `JsonSchemaObject`:

```ts
import { buildSchema } from '@rokkhopper/ai-sdk';

const schema = buildSchema((s) => ({
  name: s.string().required(),
  age:  s.integer().min(0).required(),
}));

console.log(JSON.stringify(schema, null, 2));
// {
//   "type": "object",
//   "properties": {
//     "name": { "type": "string" },
//     "age":  { "type": "integer", "minimum": 0 }
//   },
//   "required": ["name", "age"],
//   "additionalProperties": false
// }
```

## TypeScript generics

Pass the expected output type as a generic to `.prompt<T>()` to get full type safety:

```ts
type Review = {
  score: number;
  approved: boolean;
  issues: string[];
};

const response = await agent({
  instructions: 'Review the content.',
  schema: (s) => ({
    score:    s.integer().min(1).max(10).required(),
    approved: s.boolean().required(),
    issues:   s.array().items(s.string().toSchema()).required(),
  }),
}).prompt<Review>('Review this article...');

// response.structured is typed as Review
const { score, approved, issues } = response.structured;
```

::: tip
The generic type and the schema definition are independent — TypeScript does not validate that they match at compile time. Ensure they stay in sync, or use a library like [Zod](https://zod.dev) to derive both from a single source of truth.
:::
