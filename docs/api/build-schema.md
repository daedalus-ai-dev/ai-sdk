# `buildSchema(fn)`

Converts a schema function into a `JsonSchemaObject`. Useful when you need to pass a raw JSON Schema to another API.

## Signature

```ts
function buildSchema(fn: SchemaFn): JsonSchemaObject
```

Where:

```ts
type SchemaFn = (schema: SchemaBuilder) => Record<string, PropertyBuilder>
```

## Example

```ts
import { buildSchema } from '@rokkhopper/ai-sdk';

const jsonSchema = buildSchema((s) => ({
  name:   s.string().required(),
  age:    s.integer().min(0).max(150).required(),
  email:  s.string().pattern('^[^@]+@[^@]+$'),
  tags:   s.array().items(s.string().toSchema()),
  status: s.enum(['active', 'inactive']).required(),
}));

console.log(JSON.stringify(jsonSchema, null, 2));
```

Output:

```json
{
  "type": "object",
  "properties": {
    "name":   { "type": "string" },
    "age":    { "type": "integer", "minimum": 0, "maximum": 150 },
    "email":  { "type": "string", "pattern": "^[^@]+@[^@]+$" },
    "tags":   { "type": "array", "items": { "type": "string" } },
    "status": { "type": "string", "enum": ["active", "inactive"] }
  },
  "required": ["name", "age", "status"],
  "additionalProperties": false
}
```

## SchemaBuilder methods

| Method | Returns | Description |
|--------|---------|-------------|
| `s.string()` | `StringPropertyBuilder` | String type |
| `s.integer()` | `IntegerPropertyBuilder` | Integer type |
| `s.number()` | `NumberPropertyBuilder` | Float/decimal type |
| `s.boolean()` | `BooleanPropertyBuilder` | Boolean type |
| `s.array()` | `ArrayPropertyBuilder` | Array type |
| `s.enum(values)` | `EnumPropertyBuilder` | String enum type |

## PropertyBuilder methods

All builders share:

| Method | Description |
|--------|-------------|
| `.required()` | Marks property as required |
| `.description(text)` | Adds a description for the model |
| `.toSchema()` | Returns the raw `JsonSchemaProperty` object |

String-specific:

| Method | Description |
|--------|-------------|
| `.minLength(n)` | Minimum string length |
| `.maxLength(n)` | Maximum string length |
| `.pattern(regex)` | Regex pattern constraint |

Number/Integer-specific:

| Method | Description |
|--------|-------------|
| `.min(n)` | Maps to `minimum` in JSON Schema |
| `.max(n)` | Maps to `maximum` in JSON Schema |

Array-specific:

| Method | Description |
|--------|-------------|
| `.items(schema)` | Item schema — call `.toSchema()` on nested builders |

## Notes

- `buildSchema()` is called automatically by `agent()` when `schema` is provided — you rarely need to call it directly.
- The generated schema always includes `"additionalProperties": false` to prevent hallucinated extra fields.
- The `required` array is omitted entirely when no properties are marked `.required()`.
