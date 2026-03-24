import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import matter from 'gray-matter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PromptPartial {
  name: string;
  description?: string;
  instructions: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const store = new Map<string, PromptPartial>();

export function registerPartial(name: string, partial: PromptPartial): void {
  store.set(name, partial);
}

export function getPartial(name: string): PromptPartial {
  const partial = store.get(name);
  if (!partial) {
    throw new Error(
      `Partial "${name}" not registered. Call registerPartial("${name}", partial) first.`,
    );
  }
  return partial;
}

export function hasPartial(name: string): boolean {
  return store.has(name);
}

export function listPartials(): string[] {
  return [...store.keys()];
}

export function clearPartials(): void {
  store.clear();
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a partial from markdown string content.
 *
 * @example
 * const partial = parsePartial(`
 * ---
 * name: summarizer
 * description: Condenses long content into bullet points
 * ---
 * Summarize the following content concisely using bullet points.
 * `);
 */
export function parsePartial(content: string): PromptPartial {
  const { data, content: body } = matter(content);

  const name = data.name as string | undefined;
  if (!name) throw new Error('Partial markdown must have a "name" field in frontmatter.');

  return {
    name,
    description: data.description as string | undefined,
    instructions: body.trim(),
  };
}

/**
 * Load a partial from a markdown file.
 */
export async function loadPartial(filePath: string): Promise<PromptPartial> {
  const content = await readFile(filePath, 'utf-8');
  return parsePartial(content);
}

/**
 * Load all `.md` files in a directory as partials and register them.
 */
export async function loadPartialsFrom(dir: string): Promise<PromptPartial[]> {
  const entries = await readdir(dir);
  const partials: PromptPartial[] = [];

  for (const entry of entries) {
    if (extname(entry) !== '.md') continue;
    const partial = await loadPartial(join(dir, entry));
    registerPartial(partial.name, partial);
    partials.push(partial);
  }

  return partials;
}
