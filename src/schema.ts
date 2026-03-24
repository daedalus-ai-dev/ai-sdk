import type { JsonSchemaObject, JsonSchemaProperty, SchemaBuilder, SchemaFn } from './types.js';
import {
  ArrayPropertyBuilder,
  BooleanPropertyBuilder,
  EnumPropertyBuilder,
  IntegerPropertyBuilder,
  NumberPropertyBuilder,
  StringPropertyBuilder,
} from './types.js';

export const schema: SchemaBuilder = {
  string: () => new StringPropertyBuilder(),
  number: () => new NumberPropertyBuilder(),
  integer: () => new IntegerPropertyBuilder(),
  boolean: () => new BooleanPropertyBuilder(),
  array: () => new ArrayPropertyBuilder(),
  enum: (values) => new EnumPropertyBuilder(values),
};

export function buildSchema(fn: SchemaFn): JsonSchemaObject {
  const properties = fn(schema);
  const required: string[] = [];
  const cleanProperties: Record<string, JsonSchemaProperty> = {};

  for (const [key, builder] of Object.entries(properties)) {
    if (builder._required) required.push(key);
    cleanProperties[key] = builder.toSchema();
  }

  const result: JsonSchemaObject = {
    type: 'object',
    properties: cleanProperties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}
