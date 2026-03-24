# Skills

A skill is a typed, single-shot AI function — an LLM call with structured input and output, no tool loop. Use it anywhere you'd call an AI like a service: extraction, classification, summarisation, translation.

## When to use a skill vs an agent

| | `skill()` | `agent()` |
|---|---|---|
| **Input** | Typed structured object or string | Free-form string |
| **Tool loop** | No — one LLM call | Yes — iterates until done |
| **Output** | Typed structured result | Text + optional structured |
| **Use for** | Deterministic transformations | Autonomous reasoning |

## Functions

### `skill(config)`

```ts
function skill<TInput = unknown, TOutput = unknown>(
  config: SkillConfig<TInput>,
): SkillRunner<TInput, TOutput>
```

Create a skill runner. The runner is stateless — each `invoke()` call is independent.

```ts
import { skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

const classify = skill<{ text: string }, { label: string; confidence: number }>({
  instructions: 'Classify the sentiment of the provided text.',
  input: z.object({ text: z.string() }),
  output: z.object({
    label: z.enum(['positive', 'neutral', 'negative']),
    confidence: z.number().min(0).max(1),
  }),
});

const result = await classify.invoke({ text: 'I love this product!' });
console.log(result.structured.label);      // 'positive'
console.log(result.structured.confidence); // 0.94
```

---

### `registerSkill(name, config)` / `getSkill(name)`

```ts
function registerSkill<TInput = unknown>(name: string, config: SkillConfig<TInput>): void
function getSkill<TInput = unknown, TOutput = unknown>(name: string): SkillRunner<TInput, TOutput>
```

Register a skill globally and retrieve it by name from anywhere in your application.

```ts
registerSkill('classify-sentiment', {
  instructions: 'Classify the sentiment of the provided text.',
  output: z.object({ label: z.enum(['positive', 'neutral', 'negative']) }),
});

// Later, anywhere in your app:
const runner = getSkill<string, { label: string }>('classify-sentiment');
const result = await runner.invoke('This is great!');
```

---

### `hasSkill(name)` / `listSkills()` / `clearSkills()`

```ts
function hasSkill(name: string): boolean
function listSkills(): string[]
function clearSkills(): void
```

Standard registry utilities. `clearSkills()` is useful in tests to reset state between cases.

---

### `parseSkill(content)` / `loadSkill(filePath)` / `loadSkillsFrom(dir)`

```ts
function parseSkill(content: string): SkillRunner
async function loadSkill(filePath: string): Promise<SkillRunner>
async function loadSkillsFrom(dir: string): Promise<void>
```

Load skills from markdown files. `loadSkillsFrom` registers all skills found in a directory.

See [Markdown Skills](#markdown-format) below.

---

## `SkillConfig`

```ts
interface SkillConfig<TInput = unknown> {
  instructions: string;
  input?: SchemaInput;
  output?: SchemaInput;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  template?: (input: TInput) => string;
}
```

| Field | Description |
|-------|-------------|
| `instructions` | System prompt for the skill. |
| `input` | Input schema. If Zod, input is validated before calling the LLM. |
| `output` | Output schema for structured responses. Accepts Zod, fluent builder, or raw JSON Schema. |
| `model` | Model identifier. Falls back to the global default set by `configure()`. |
| `temperature` | Sampling temperature. |
| `maxTokens` | Max output tokens. |
| `template` | Custom function to render the input into a prompt string. Defaults to `JSON.stringify` for objects, or the value itself for strings. |

---

## `SkillResult`

```ts
interface SkillResult<TOutput = unknown> {
  text: string;
  structured: TOutput;
  usage: { inputTokens: number; outputTokens: number };
}
```

---

## Input handling

How the input is rendered into a prompt:

| Input type | No template | With template |
|------------|------------|---------------|
| `string` | Passed directly | `template(input)` |
| `object` | `JSON.stringify(input, null, 2)` | `template(input)` |

Use `template` when you want narrative framing rather than raw JSON:

```ts
const summarize = skill<{ title: string; body: string }>({
  instructions: 'Summarize the article in three sentences.',
  template: ({ title, body }) => `Title: ${title}\n\n${body}`,
});
```

---

## Markdown format

```markdown
---
name: extract-entities
model: anthropic/claude-3-5-sonnet
input:
  text: string!
output:
  people: string[]
  places: string[]
  organisations: string[]
---
Extract all named entities from the provided text.
Group them by type: people, places, and organisations.
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Registry key used by `getSkill()`. |
| `model` | No | Model override. Falls back to global default. |
| `input` | No | Input schema in YAML shorthand or object form. |
| `output` | No | Output schema in YAML shorthand or object form. |
| `temperature` | No | Sampling temperature. |
| `maxTokens` | No | Max output tokens. |
| Body | Yes | The system instructions. |

```ts
await loadSkillsFrom('./skills');

const runner = getSkill('extract-entities');
const result = await runner.invoke({ text: 'Tim Cook visited Berlin last Tuesday.' });
```

::: tip YAML schema shorthand
See [yamlSchemaToJsonSchema](/api/loader#yamlschematojsonschema) for the full shorthand reference (`string!`, `string[]`, etc.).
:::
