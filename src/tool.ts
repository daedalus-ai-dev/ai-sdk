import type { ToolDefinition, JsonSchemaObject, SchemaFn } from './types.js';
import { buildSchema } from './schema.js';

// ─── Tool interface ───────────────────────────────────────────────────────────

export interface Tool {
  /** Unique identifier for the tool (defaults to class name if not overridden). */
  name(): string;
  /** Human-readable description telling the LLM when and how to use this tool. */
  description(): string;
  /** Input schema definition using the fluent JsonSchema builder. */
  schema(builder: import('./types.js').SchemaBuilder): Record<string, import('./types.js').PropertyBuilder>;
  /** Execute the tool and return a string result (or a promise thereof). */
  handle(input: Record<string, unknown>): Promise<string> | string;
}

// Internal symbol used by MCP adapter tools to bypass the schema builder
export const RAW_INPUT_SCHEMA = Symbol('rawInputSchema');

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toolToDefinition(tool: Tool): ToolDefinition {
  // MCP adapter tools carry a pre-built JSON Schema — skip the builder
  const raw = (tool as unknown as Record<symbol, unknown>)[RAW_INPUT_SCHEMA];
  const inputSchema = raw !== undefined
    ? raw as JsonSchemaObject
    : buildSchema(tool.schema.bind(tool) as SchemaFn) as JsonSchemaObject;

  return {
    name: tool.name(),
    description: tool.description(),
    inputSchema,
  };
}

// ─── Functional tool builder ──────────────────────────────────────────────────

interface FunctionalToolOptions {
  name: string;
  description: string;
  schema: SchemaFn;
  handle: (input: Record<string, unknown>) => Promise<string> | string;
}

export function defineTool(options: FunctionalToolOptions): Tool {
  return {
    name: () => options.name,
    description: () => options.description,
    schema: options.schema,
    handle: options.handle,
  };
}
