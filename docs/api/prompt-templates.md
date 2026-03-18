# Prompt Templates

The SDK provides two approaches for building reusable, parameterized prompts.

## `promptTemplate`

A tagged template literal that infers variable names at compile time, giving you full TypeScript type safety.

```ts
import { promptTemplate } from '@daedalus-ai-dev/ai-sdk';

const summarize = promptTemplate`Summarize the following ${'language'} code:\n\n${'code'}`;

const prompt = summarize({ language: 'TypeScript', code: '...' });
```

TypeScript will error if you forget a variable or misspell its name:

```ts
summarize({ language: 'TypeScript' }); // ✗ Property 'code' is missing
summarize({ language: 'TypeScript', cde: '...' }); // ✗ 'cde' does not exist
```

### Signature

```ts
function promptTemplate<const Keys extends string[]>(
  strings: TemplateStringsArray,
  ...keys: Keys
): (vars: { [K in Keys[number]]: string }) => string
```

---

## `createPrompt`

Creates a prompt function from a plain string using `{{variable}}` placeholder syntax. Ideal when templates come from config files, databases, or user input.

```ts
import { createPrompt } from '@daedalus-ai-dev/ai-sdk';

const classify = createPrompt(
  'Classify the following as {{sentiment}}:\n\n{{text}}'
);

const prompt = classify({
  sentiment: 'positive / negative / neutral',
  text: 'The product was amazing!',
});
```

Missing variables throw at runtime:

```ts
classify({ sentiment: 'positive' });
// ✗ Error: Missing template variable: "text"
```

### Signature

```ts
function createPrompt(template: string): (vars: Record<string, string>) => string
```

---

## Choosing Between the Two

| | `promptTemplate` | `createPrompt` |
|---|---|---|
| Type safety | Compile-time | Runtime |
| Template source | Inline code | Any string |
| Variable syntax | `` ${'var'} `` | `{{var}}` |
| Best for | Library code, static prompts | Config-driven prompts |

---

## Practical Examples

### System prompt factory

```ts
const systemPrompt = promptTemplate`You are ${'name'}, a ${'role'} assistant.
Your primary language is ${'language'}.
Always respond in ${'tone'} tone.`;

const prompt = systemPrompt({
  name: 'Aria',
  role: 'customer support',
  language: 'English',
  tone: 'friendly and professional',
});
```

### Loading from config

```ts
const templates = {
  summarize: 'Summarize the following in {{language}}: {{text}}',
  translate: 'Translate the following to {{target_language}}: {{text}}',
};

const summarize = createPrompt(templates.summarize);
const translate = createPrompt(templates.translate);

const summary = summarize({ language: 'French', text: '...' });
```

### Using with `agent()`

```ts
import { agent, anthropic, promptTemplate } from '@daedalus-ai-dev/ai-sdk';

const systemTpl = promptTemplate`You are an expert ${'domain'} assistant.`;

const codeReviewer = agent({
  provider: anthropic('claude-opus-4-6'),
  system: systemTpl({ domain: 'TypeScript code review' }),
});

const result = await codeReviewer.prompt('Review this function...');
```
