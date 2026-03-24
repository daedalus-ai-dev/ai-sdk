import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import matter from 'gray-matter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description?: string;
  instructions: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const store = new Map<string, Skill>();

export function registerSkill(name: string, skill: Skill): void {
  store.set(name, skill);
}

export function getSkill(name: string): Skill {
  const skill = store.get(name);
  if (!skill) {
    throw new Error(
      `Skill "${name}" not registered. Call registerSkill("${name}", skill) first.`,
    );
  }
  return skill;
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

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a skill from markdown string content.
 *
 * @example
 * const skill = parseSkill(`
 * ---
 * name: summarizer
 * description: Condenses long content into bullet points
 * ---
 * Summarize the following content concisely using bullet points.
 * `);
 */
export function parseSkill(content: string): Skill {
  const { data, content: body } = matter(content);

  const name = data['name'] as string | undefined;
  if (!name) throw new Error('Skill markdown must have a "name" field in frontmatter.');

  return {
    name,
    description: data['description'] as string | undefined,
    instructions: body.trim(),
  };
}

/**
 * Load a skill from a markdown file.
 */
export async function loadSkill(filePath: string): Promise<Skill> {
  const content = await readFile(filePath, 'utf-8');
  return parseSkill(content);
}

/**
 * Load all `.md` files in a directory as skills and register them.
 */
export async function loadSkillsFrom(dir: string): Promise<Skill[]> {
  const entries = await readdir(dir);
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (extname(entry) !== '.md') continue;
    const skill = await loadSkill(join(dir, entry));
    registerSkill(skill.name, skill);
    skills.push(skill);
  }

  return skills;
}
