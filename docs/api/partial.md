# Partials

A partial is a named, reusable instruction fragment. Skills are stored in a global registry and can be embedded into any agent's system prompt using the <code v-pre>{{partial:name}}</code> placeholder.

## Functions

### `loadPartialsFrom(dir)`

```ts
async function loadPartialsFrom(dir: string): Promise<PromptPartial[]>
```

Read every `.md` file in `dir`, parse each one as a partial, register it, and return the list. Call this before loading any agents that reference partials.

```ts
await loadPartialsFrom('./skills');
```

---

### `loadSkill(filePath)`

```ts
async function loadSkill(filePath: string): Promise<Skill>
```

Load a single partial file and register it.

---

### `parsePartial(content)`

```ts
function parsePartial(content: string): Skill
```

Parse a partial from a markdown string. Does **not** register it — call `registerPartial` if you want it in the registry.

```ts
const skill = parsePartial(`
---
name: tone
description: Sets the response tone
---
Always respond in a clear, professional tone.
`);
```

---

### `registerPartial(name, skill)`

```ts
function registerPartial(name: string, skill: Skill): void
```

Register a partial manually. Useful when generating partials programmatically or in tests.

---

### `getPartial(name)` / `hasPartial(name)` / `listPartials()` / `clearPartials()`

```ts
function getPartial(name: string): Skill      // throws if not found
function hasPartial(name: string): boolean
function listPartials(): string[]
function clearPartials(): void
```

Standard registry utilities. `clearPartials()` is useful in tests to reset state between cases.

---

## `PromptPartial`

```ts
interface PromptPartial {
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
| `name` | Yes | Registry key. Used in <code v-pre>{{partial:name}}</code> placeholders. |
| `description` | No | Human-readable description of the skill's purpose. |
| Body | Yes | The instruction text injected at the placeholder site. |

---

## Using partials in agents

Reference a registered partial anywhere in an agent's instruction body:

```markdown
---
name: researcher
model: anthropic/claude-3-5-sonnet
---
You are a research specialist.

{{partial:tone}}
{{partial:citation-style}}

Focus on primary sources when possible.
```

The placeholder is replaced with the skill's full instruction text when the agent is loaded.

---

## Example

```ts
import {
  loadPartialsFrom,
  loadAgentsFrom,
  getAgent,
  configure,
  anthropic,
  WebFetch,
} from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-3-5-sonnet-20241022') });

// Partials must be registered before agents that reference them
await loadPartialsFrom('./skills');
await loadAgentsFrom('./agents', { tools: { 'web-fetch': new WebFetch() } });

const response = await getAgent('researcher').prompt('Latest news on fusion energy?');
console.log(response.text);
```

### In tests

```ts
import { registerPartial, clearPartials, parseAgent } from '@daedalus-ai-dev/ai-sdk';
import { beforeEach } from 'vitest';

beforeEach(() => clearPartials());

test('agent uses partial instructions', () => {
  registerPartial('tone', { name: 'tone', instructions: 'Be concise.' });

  const runner = parseAgent(`
---
name: assistant
---
Help the user. {{partial:tone}}
  `);

  expect(runner).toBeDefined();
});
```
