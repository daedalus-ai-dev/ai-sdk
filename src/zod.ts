import { createRequire } from 'node:module';
import type { JsonSchemaObject, ZodLike } from './types.js';

// ─── Raw JSON Schema detection ────────────────────────────────────────────────

export function isRawJsonSchema(value: unknown): value is JsonSchemaObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'object' &&
    'properties' in value
  );
}

// ─── Detection ────────────────────────────────────────────────────────────────

export function isZodSchema(value: unknown): value is ZodLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as Record<string, unknown>).parse === 'function' &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

// ─── Conversion ───────────────────────────────────────────────────────────────

const _require = createRequire(import.meta.url);

/**
 * Convert a Zod schema to a JSON Schema object.
 * Requires `zod-to-json-schema` to be installed as a peer dependency.
 */
export function zodToJsonSchema(zodSchema: ZodLike): JsonSchemaObject {
  let mod: Record<string, unknown>;
  try {
    mod = _require('zod-to-json-schema') as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'Zod schema detected but `zod-to-json-schema` is not installed.\n' +
          'Run: npm install zod-to-json-schema',
      );
    }
    throw err;
  }

  const fn =
    (mod.zodToJsonSchema as ((s: unknown) => unknown) | undefined) ??
    ((mod.default as Record<string, unknown> | undefined)?.zodToJsonSchema as
      | ((s: unknown) => unknown)
      | undefined);

  if (typeof fn !== 'function') {
    throw new Error('Could not find zodToJsonSchema export in zod-to-json-schema');
  }

  return fn(zodSchema) as JsonSchemaObject;
}
