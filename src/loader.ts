import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import matter from 'gray-matter';
import { agent } from './agent.js';
import type { AgentConfig } from './agent.js';
import { registerAgent } from './registry.js';
import { getPartial, hasPartial } from './partial.js';
import type { Tool } from './tool.js';
import type { JsonSchemaObject, JsonSchemaProperty } from './types.js';

// ─── YAML schema → JsonSchemaObject ──────────────────────────────────────────

type SimpleType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

function resolveItemType(items: unknown): JsonSchemaProperty {
  if (typeof items === 'string') return { type: items as SimpleType } as unknown as JsonSchemaProperty;
  if (typeof items === 'object' && items !== null)
    return buildProperty(items as Record<string, unknown>).prop;
  return { type: 'string' } as JsonSchemaProperty;
}

function buildProperty(obj: Record<string, unknown>): { prop: JsonSchemaProperty; required: boolean } {
  const { required, items, ...rest } = obj;
  const prop: Record<string, unknown> = { ...rest };
  if (items !== undefined) prop['items'] = resolveItemType(items);
  return { prop: prop as unknown as JsonSchemaProperty, required: required === true };
}

/**
 * Convert a plain YAML schema declaration (from frontmatter) to a JsonSchemaObject.
 *
 * Supports shorthand forms:
 *   `field: string`   — type only, optional
 *   `field: string!`  — type only, required
 *   `field: string[]` — array of strings, optional
 *
 * And the full object form:
 *   ```yaml
 *   field:
 *     type: string
 *     required: true
 *     description: "..."
 *   ```
 */
export function yamlSchemaToJsonSchema(yamlSchema: Record<string, unknown>): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const requiredFields: string[] = [];

  for (const [key, value] of Object.entries(yamlSchema)) {
    if (typeof value === 'string') {
      let typeName = value.trim();
      let isRequired = false;

      if (typeName.endsWith('!')) {
        isRequired = true;
        typeName = typeName.slice(0, -1);
      }

      if (typeName.endsWith('[]')) {
        const itemType = typeName.slice(0, -2);
        properties[key] = {
          type: 'array',
          items: { type: itemType as SimpleType } as JsonSchemaProperty,
        };
      } else {
        properties[key] = { type: typeName as SimpleType } as JsonSchemaProperty;
      }

      if (isRequired) requiredFields.push(key);
    } else if (typeof value === 'object' && value !== null) {
      const { prop, required } = buildProperty(value as Record<string, unknown>);
      properties[key] = prop;
      if (required) requiredFields.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
  };
}

// ─── Partial interpolation ────────────────────────────────────────────────────

function resolvePartialInterpolations(instructions: string): string {
  return instructions.replace(/\{\{partial:([^}]+)\}\}/g, (_, name: string) => {
    const partialName = name.trim();
    if (!hasPartial(partialName)) {
      throw new Error(
        `Partial "${partialName}" referenced in agent instructions but not registered. ` +
          `Call loadPartialsFrom() or registerPartial() before loadAgent().`,
      );
    }
    return getPartial(partialName).instructions;
  });
}

// ─── Agent loading ────────────────────────────────────────────────────────────

export interface LoadAgentOptions {
  /** Map of tool name → Tool instance for resolving tools listed in frontmatter. */
  tools?: Record<string, Tool>;
}

function parseAgentConfig(content: string, options?: LoadAgentOptions): AgentConfig {
  const { data, content: body } = matter(content);

  const name = data['name'] as string | undefined;
  if (!name) throw new Error('Agent markdown must have a "name" field in frontmatter.');

  const instructions = resolvePartialInterpolations(body.trim());

  const toolNames: string[] = Array.isArray(data['tools']) ? (data['tools'] as string[]) : [];
  const resolvedTools = toolNames.map((toolName) => {
    const tool = options?.tools?.[toolName];
    if (!tool) {
      throw new Error(
        `Tool "${toolName}" listed in agent "${name}" frontmatter but not provided in options.tools.`,
      );
    }
    return tool;
  });

  const schemaInput =
    data['schema'] && typeof data['schema'] === 'object'
      ? yamlSchemaToJsonSchema(data['schema'] as Record<string, unknown>)
      : undefined;

  return {
    instructions,
    ...(resolvedTools.length > 0 ? { tools: resolvedTools } : {}),
    ...(data['model'] ? { model: data['model'] as string } : {}),
    ...(data['maxIterations'] ? { maxIterations: data['maxIterations'] as number } : {}),
    ...(data['temperature'] !== undefined ? { temperature: data['temperature'] as number } : {}),
    ...(data['maxTokens'] ? { maxTokens: data['maxTokens'] as number } : {}),
    ...(schemaInput ? { schema: schemaInput } : {}),
  };
}

/**
 * Parse an agent from markdown string content and return an AgentRunner.
 * Partials referenced via `{{partial:name}}` must already be registered.
 *
 * @example
 * const runner = parseAgent(`
 * ---
 * name: researcher
 * model: anthropic/claude-3-5-sonnet
 * tools: [web-fetch]
 * ---
 * You are a research assistant. Always cite your sources.
 * `, { tools: { 'web-fetch': webFetch } });
 */
export function parseAgent(
  content: string,
  options?: LoadAgentOptions,
): ReturnType<typeof agent> {
  return agent(parseAgentConfig(content, options));
}

/**
 * Load an agent from a markdown file and return an AgentRunner.
 */
export async function loadAgent(
  filePath: string,
  options?: LoadAgentOptions,
): Promise<ReturnType<typeof agent>> {
  const content = await readFile(filePath, 'utf-8');
  return parseAgent(content, options);
}

/**
 * Load all `.md` files in a directory as agents and register them by name.
 * Partials must be loaded first if agents reference `{{partial:name}}`.
 *
 * @example
 * await loadPartialsFrom('./partials');
 * await loadAgentsFrom('./agents', { tools: { 'web-fetch': webFetch } });
 * const response = await getAgent('researcher').prompt('What is TypeScript?');
 */
export async function loadAgentsFrom(dir: string, options?: LoadAgentOptions): Promise<void> {
  const entries = await readdir(dir);

  for (const entry of entries) {
    if (extname(entry) !== '.md') continue;
    const content = await readFile(join(dir, entry), 'utf-8');
    const config = parseAgentConfig(content, options);
    const name = (matter(content).data['name'] as string | undefined) ?? entry;
    registerAgent(name, config);
  }
}
