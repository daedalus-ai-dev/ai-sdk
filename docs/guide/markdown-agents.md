# Markdown Agents & Partials

Instead of defining agents in TypeScript, you can write them as markdown files with YAML frontmatter. This keeps system prompts readable, makes agents easy to edit without touching code, and lets non-engineers contribute prompt changes through normal file edits.

## Partials

A **partial** is a reusable instruction fragment that can be embedded inside any agent's instructions. Think of it as a shared paragraph you don't want to copy-paste.

```
partials/
  tone.md
  citation-style.md
agents/
  researcher.md
  writer.md
```

**`partials/tone.md`**

```markdown
---
name: tone
description: Sets the response tone
---
Always respond in a clear, professional tone. Avoid jargon unless the user is clearly technical.
```

**`partials/citation-style.md`**

```markdown
---
name: citation-style
description: How to cite sources
---
When citing sources, use the format: [Source: <title>, <url>]. Always cite at least one source per factual claim.
```

## Agents

An agent file has YAML frontmatter for configuration and a markdown body for the system prompt.

**`agents/researcher.md`**

```markdown
---
name: researcher
model: anthropic/claude-3-5-sonnet
tools: [web-fetch]
maxIterations: 8
---
You are a research specialist. Find accurate, up-to-date information on the topic provided.

{{partial:tone}}

{{partial:citation-style}}
```

**`agents/writer.md`**

```markdown
---
name: writer
model: anthropic/claude-3-5-sonnet
---
You are a professional writer. Turn research notes into polished prose.

{{partial:tone}}
```

The <code v-pre>{{partial:name}}</code> placeholder is replaced with the partial's instruction text at load time.

## Loading in code

```ts
import {
  configure,
  anthropic,
  loadPartialsFrom,
  loadAgentsFrom,
  getAgent,
  WebFetch,
} from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-3-5-sonnet-20241022') });

// 1. Load partials first — agents reference them
await loadPartialsFrom('./partials');

// 2. Load agents — tools are resolved by name
await loadAgentsFrom('./agents', {
  tools: { 'web-fetch': new WebFetch() },
});

// 3. Use agents from the registry
const response = await getAgent('researcher').prompt(
  'What are the latest developments in quantum computing?'
);
console.log(response.text);
```

Partials must be loaded before agents that reference them.

## Frontmatter reference

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | **Required.** Identifies the agent in the registry. |
| `model` | `string` | Model identifier (e.g. `anthropic/claude-3-5-sonnet`). Falls back to the global default. |
| `tools` | `string[]` | Tool names to attach. Resolved from `options.tools` at load time. |
| `maxIterations` | `number` | Max tool-call loop iterations (default: `10`). |
| `temperature` | `number` | Sampling temperature. |
| `maxTokens` | `number` | Max output tokens. |
| `schema` | object | Structured output schema (see below). |

## Structured output

Define an output schema directly in frontmatter using YAML:

```markdown
---
name: analyst
model: anthropic/claude-3-5-sonnet
schema:
  summary: string!
  sentiment: string!
  score: number!
  tags: string[]
---
Analyse the content provided and return structured output.
```

### Schema shorthand

| Syntax | Meaning |
|--------|---------|
| `field: string` | Optional string field |
| `field: string!` | Required string field |
| `field: string[]` | Optional array of strings |
| `field: number!` | Required number field |
| `field: boolean` | Optional boolean field |

### Full object form

For extra properties like `description`, use the expanded form:

```yaml
schema:
  summary:
    type: string
    required: true
    description: A one-paragraph summary
  score:
    type: integer
    required: true
  tags:
    type: array
    items: string
```

## Loading a single file

When you only need one agent, use `loadAgent` instead of scanning a directory:

```ts
import { loadAgent } from '@daedalus-ai-dev/ai-sdk';

const runner = await loadAgent('./agents/researcher.md', {
  tools: { 'web-fetch': new WebFetch() },
});

const response = await runner.prompt('Summarise the latest AI news.');
```

## Parsing from a string

Useful in tests or when fetching definitions from a database or CMS:

```ts
import { parseAgent, parsePartial, registerPartial } from '@daedalus-ai-dev/ai-sdk';

registerPartial('tone', parsePartial(`
---
name: tone
---
Be concise and direct.
`));

const runner = parseAgent(`
---
name: assistant
model: openai/gpt-4o-mini
---
You are a helpful assistant. {{partial:tone}}
`);
```

## Combining with code-defined agents

Markdown agents integrate with the same registry as code-defined ones. After loading, `getAgent` and `agentTool` work identically:

```ts
import { agentTool, agent } from '@daedalus-ai-dev/ai-sdk';

// After loadAgentsFrom() — use markdown agents as workers
const orchestrator = agent({
  instructions: 'Coordinate the research and writing pipeline.',
  tools: [
    agentTool('researcher'),  // loaded from markdown
    agentTool('writer'),      // loaded from markdown
  ],
});
```
