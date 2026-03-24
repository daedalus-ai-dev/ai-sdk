# Markdown Agent Loader

Load agents defined as markdown files with YAML frontmatter. Integrates with the [Agent Registry](/api/registry) so loaded agents are immediately available via `getAgent()` and `agentTool()`.

## Functions

### `loadAgentsFrom(dir, options?)`

```ts
async function loadAgentsFrom(
  dir: string,
  options?: LoadAgentOptions,
): Promise<void>
```

Read every `.md` file in `dir`, parse each one as an agent, and register it by its `name` frontmatter field. If agents reference <code v-pre>{{partial:name}}</code> placeholders, call `loadPartialsFrom()` first.

```ts
await loadPartialsFrom('./partials');
await loadAgentsFrom('./agents', {
  tools: { 'web-fetch': new WebFetch() },
});
```

---

### `loadAgent(filePath, options?)`

```ts
async function loadAgent(
  filePath: string,
  options?: LoadAgentOptions,
): Promise<AgentRunner>
```

Load a single agent file and return an `AgentRunner` directly (without registering it).

```ts
const runner = await loadAgent('./agents/researcher.md', {
  tools: { 'web-fetch': new WebFetch() },
});

const response = await runner.prompt('...');
```

---

### `parseAgent(content, options?)`

```ts
function parseAgent(
  content: string,
  options?: LoadAgentOptions,
): AgentRunner
```

Parse an agent from a markdown string. Useful in tests or when loading definitions from a database or CMS.

```ts
const runner = parseAgent(`
---
name: assistant
model: openai/gpt-4o-mini
---
You are a helpful assistant.
`);
```

---

### `yamlSchemaToJsonSchema(yamlSchema)`

```ts
function yamlSchemaToJsonSchema(
  yamlSchema: Record<string, unknown>,
): JsonSchemaObject
```

Convert a YAML schema declaration to a `JsonSchemaObject`. Used internally by the loader but exported for advanced use cases.

Supports shorthand:

```ts
yamlSchemaToJsonSchema({
  summary: 'string!',   // required string
  tags:    'string[]',  // optional array of strings
  score:   'number!',   // required number
});
```

And the full object form:

```ts
yamlSchemaToJsonSchema({
  summary: { type: 'string', required: true, description: 'A short summary' },
  score:   { type: 'integer', required: true },
});
```

---

## `LoadAgentOptions`

```ts
interface LoadAgentOptions {
  /** Map of tool name → Tool instance for resolving tools listed in frontmatter. */
  tools?: Record<string, Tool>;
}
```

---

## Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | **Required.** Registry key and display name. |
| `model` | `string` | Model identifier. Falls back to the global default set by `configure()`. |
| `tools` | `string[]` | Tool names resolved from `options.tools`. |
| `maxIterations` | `number` | Max iterations for the agent loop (default: `10`). |
| `temperature` | `number` | Sampling temperature passed to the provider. |
| `maxTokens` | `number` | Max output tokens. |
| `schema` | object | Structured output schema in YAML shorthand or object form. |

---

## Errors

| Message | Cause |
|---------|-------|
| `Agent markdown must have a "name" field in frontmatter.` | Frontmatter is missing `name`. |
| `Tool "<name>" listed in agent "<agent>" frontmatter but not provided in options.tools.` | A tool name in `tools:` has no matching entry in `options.tools`. |
| `Partial "<name>" referenced in agent instructions but not registered.` | <code v-pre>{{partial:name}}</code> used before the partial was registered. |
