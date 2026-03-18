# `configure(options)`

Sets global defaults for all `agent()` calls. Call this once at application startup.

## Signature

```ts
function configure(options: {
  provider?: AIProvider;
  model?: string;
}): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `AIProvider` | The default provider for all agents |
| `model` | `string` | The default model identifier |

## Example

```ts
import { configure, openrouter } from '@rokkhopper/ai-sdk';

configure({
  provider: openrouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
  }),
  model: 'openai/gpt-4o-mini',
});
```

After calling `configure()`, any `agent()` call without an explicit `provider` or `model` will use these defaults:

```ts
// Uses the globally configured provider and model
const response = await agent({
  instructions: 'Be helpful.',
}).prompt('Hello!');

// Overrides the model for this agent only
const powerfulResponse = await agent({
  instructions: 'Reason carefully.',
  model: 'anthropic/claude-3-5-sonnet',
}).prompt('Solve this complex problem...');
```

## Notes

- `configure()` is **global state** — it affects all subsequent `agent()` calls in the process.
- In a test environment, pass `provider` directly to each `agent()` instead of using `configure()` to keep tests isolated.
- Per-agent `provider` and `model` always override the global defaults.
