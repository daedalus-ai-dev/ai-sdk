# Skills

A skill is a named, reusable instruction fragment. Skills are stored in a global registry and can be embedded into any agent's system prompt using the `{{skill:name}}` placeholder.

## Functions

### `loadSkillsFrom(dir)`

```ts
async function loadSkillsFrom(dir: string): Promise<Skill[]>
```

Read every `.md` file in `dir`, parse each one as a skill, register it, and return the list. Call this before loading any agents that reference skills.

```ts
await loadSkillsFrom('./skills');
```

---

### `loadSkill(filePath)`

```ts
async function loadSkill(filePath: string): Promise<Skill>
```

Load a single skill file and register it.

---

### `parseSkill(content)`

```ts
function parseSkill(content: string): Skill
```

Parse a skill from a markdown string. Does **not** register it — call `registerSkill` if you want it in the registry.

```ts
const skill = parseSkill(`
---
name: tone
description: Sets the response tone
---
Always respond in a clear, professional tone.
`);
```

---

### `registerSkill(name, skill)`

```ts
function registerSkill(name: string, skill: Skill): void
```

Register a skill manually. Useful when generating skills programmatically or in tests.

---

### `getSkill(name)` / `hasSkill(name)` / `listSkills()` / `clearSkills()`

```ts
function getSkill(name: string): Skill      // throws if not found
function hasSkill(name: string): boolean
function listSkills(): string[]
function clearSkills(): void
```

Standard registry utilities. `clearSkills()` is useful in tests to reset state between cases.

---

## `Skill`

```ts
interface Skill {
  name: string;
  description?: string;
  instructions: string;
}
```

---

## Markdown format

```markdown
---
name: citation-style
description: How to cite sources in responses
---
When citing sources, use the format: [Source: <title>, <url>].
Always cite at least one source per factual claim.
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Registry key. Used in `{{skill:name}}` placeholders. |
| `description` | No | Human-readable description of the skill's purpose. |
| Body | Yes | The instruction text injected at the placeholder site. |

---

## Using skills in agents

Reference a registered skill anywhere in an agent's instruction body:

```markdown
---
name: researcher
model: anthropic/claude-3-5-sonnet
---
You are a research specialist.

{{skill:tone}}
{{skill:citation-style}}

Focus on primary sources when possible.
```

The placeholder is replaced with the skill's full instruction text when the agent is loaded.

---

## Example

```ts
import {
  loadSkillsFrom,
  loadAgentsFrom,
  getAgent,
  configure,
  anthropic,
  WebFetch,
} from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-3-5-sonnet-20241022') });

// Skills must be registered before agents that reference them
await loadSkillsFrom('./skills');
await loadAgentsFrom('./agents', { tools: { 'web-fetch': new WebFetch() } });

const response = await getAgent('researcher').prompt('Latest news on fusion energy?');
console.log(response.text);
```

### In tests

```ts
import { registerSkill, clearSkills, parseAgent } from '@daedalus-ai-dev/ai-sdk';
import { beforeEach } from 'vitest';

beforeEach(() => clearSkills());

test('agent uses skill instructions', () => {
  registerSkill('tone', { name: 'tone', instructions: 'Be concise.' });

  const runner = parseAgent(`
---
name: assistant
---
Help the user. {{skill:tone}}
  `);

  expect(runner).toBeDefined();
});
```
