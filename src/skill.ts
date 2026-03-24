import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import matter from 'gray-matter';
import { agent } from './agent.js';
import { isZodSchema } from './zod.js';
import { yamlSchemaToJsonSchema } from './loader.js';
import type { SchemaInput } from './types.js';
import * as log from './logger.js';
import { enterSkillContext, exitSkillContext } from './logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillConfig<TInput = unknown> {
  /** System instructions for the skill. */
  instructions: string;
  /**
   * Input schema for runtime validation (Zod only) and type guidance.
   * If a Zod schema is provided, input is validated before the LLM is called.
   */
  input?: SchemaInput;
  /** Output schema for structured responses. Accepts Zod, fluent builder, or raw JSON Schema. */
  output?: SchemaInput;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Custom function to render the input into a prompt string.
   * Defaults to JSON.stringify for objects, or the value itself for strings.
   */
  template?: (input: TInput) => string;
}

export interface SkillResult<TOutput = unknown> {
  /** Raw text response from the model. */
  text: string;
  /** Parsed structured output. Only populated when `output` schema is provided. */
  structured: TOutput;
  usage: { inputTokens: number; outputTokens: number };
}

export interface SkillRunner<TInput = unknown, TOutput = unknown> {
  invoke(input: TInput): Promise<SkillResult<TOutput>>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a typed, single-shot AI function.
 *
 * Unlike `agent()`, a skill has no tool loop — it makes one LLM call and returns
 * a typed result. Use it for deterministic transformations: extraction, classification,
 * summarisation, translation.
 *
 * @example
 * const classify = skill<{ text: string }, { label: string; confidence: number }>({
 *   instructions: 'Classify the sentiment of the provided text.',
 *   input: z.object({ text: z.string() }),
 *   output: z.object({ label: z.enum(['positive', 'neutral', 'negative']), confidence: z.number() }),
 * });
 *
 * const result = await classify.invoke({ text: 'I love this product!' });
 * console.log(result.structured.label); // 'positive'
 */
export function skill<TInput = unknown, TOutput = unknown>(
  config: SkillConfig<TInput>,
): SkillRunner<TInput, TOutput> {
  return {
    async invoke(input: TInput): Promise<SkillResult<TOutput>> {
      // Validate input if a Zod schema is provided
      if (config.input && isZodSchema(config.input)) {
        config.input.parse(input);
      }

      // Build the user prompt from the input
      const userPrompt = config.template
        ? config.template(input)
        : typeof input === 'string'
          ? input
          : JSON.stringify(input, null, 2);

      log.skillStart(config.instructions);
      log.skillPrompt(userPrompt);

      // Single-shot call — no tools, one iteration
      const runner = agent({
        instructions: config.instructions,
        ...(config.output ? { schema: config.output } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
        maxIterations: 1,
      });

      enterSkillContext();
      let result;
      try {
        result = await runner.prompt<TOutput>(userPrompt);
      } finally {
        exitSkillContext();
      }

      // Skills are single-shot and have no tools, so interrupted responses cannot occur.
      if ('interrupted' in result) {
        throw new Error('Skill received an unexpected interrupted response.');
      }

      log.skillDone(result.structured, result.usage);
      return {
        text: result.text,
        structured: result.structured,
        usage: result.usage,
      };
    },
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const store = new Map<string, SkillConfig<unknown>>();

/**
 * Register a skill by name so it can be retrieved anywhere with `getSkill()`.
 */
export function registerSkill<TInput = unknown>(
  name: string,
  config: SkillConfig<TInput>,
): void {
  store.set(name, config as SkillConfig<unknown>);
}

/**
 * Retrieve a registered skill by name and return a typed runner.
 */
export function getSkill<TInput = unknown, TOutput = unknown>(
  name: string,
): SkillRunner<TInput, TOutput> {
  const config = store.get(name);
  if (!config) {
    throw new Error(`Skill "${name}" not registered. Call registerSkill("${name}", config) first.`);
  }
  return skill<TInput, TOutput>(config as SkillConfig<TInput>);
}

export function hasSkill(name: string): boolean {
  return store.has(name);
}

export function listSkills(): string[] {
  return [...store.keys()];
}

export function clearSkills(): void {
  store.clear();
}

// ─── Markdown loading ─────────────────────────────────────────────────────────

function skillConfigFromContent(content: string): { name: string; config: SkillConfig<unknown> } {
  const { data, content: body } = matter(content);

  const name = data['name'] as string | undefined;
  if (!name) throw new Error('Skill markdown must have a "name" field in frontmatter.');

  const inputSchema =
    data['input'] && typeof data['input'] === 'object'
      ? yamlSchemaToJsonSchema(data['input'] as Record<string, unknown>)
      : undefined;

  const outputSchema =
    data['output'] && typeof data['output'] === 'object'
      ? yamlSchemaToJsonSchema(data['output'] as Record<string, unknown>)
      : undefined;

  return {
    name,
    config: {
      instructions: body.trim(),
      ...(inputSchema ? { input: inputSchema } : {}),
      ...(outputSchema ? { output: outputSchema } : {}),
      ...(data['model'] ? { model: data['model'] as string } : {}),
      ...(data['temperature'] !== undefined ? { temperature: data['temperature'] as number } : {}),
      ...(data['maxTokens'] ? { maxTokens: data['maxTokens'] as number } : {}),
    },
  };
}

/**
 * Parse a skill from markdown string content and return a runner.
 *
 * @example
 * ```markdown
 * ---
 * name: summarize
 * model: anthropic/claude-3-5-sonnet
 * output:
 *   summary: string!
 *   bullets: string[]
 * ---
 * Summarize the provided text. Return a one-paragraph summary and key bullet points.
 * ```
 */
export function parseSkill(content: string): SkillRunner {
  const { config } = skillConfigFromContent(content);
  return skill(config);
}

/**
 * Load a skill from a markdown file and return a runner.
 */
export async function loadSkill(filePath: string): Promise<SkillRunner> {
  const content = await readFile(filePath, 'utf-8');
  return parseSkill(content);
}

/**
 * Load all `.md` files in a directory as skills and register them by name.
 */
export async function loadSkillsFrom(dir: string): Promise<void> {
  const entries = await readdir(dir);

  for (const entry of entries) {
    if (extname(entry) !== '.md') continue;
    const content = await readFile(join(dir, entry), 'utf-8');
    const { name, config } = skillConfigFromContent(content);
    registerSkill(name, config);
  }
}
