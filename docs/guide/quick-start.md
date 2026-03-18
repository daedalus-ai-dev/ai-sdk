# Quick Start

This page walks through the most common SDK usage in five minutes. Each example builds on the previous one.

## 1. Configure a provider

Call `configure()` once at your application's entry point. All subsequent `agent()` calls will use these defaults.

```ts
import { configure, openrouter } from '@rokkhopper/ai-sdk';

configure({
  provider: openrouter({ apiKey: process.env.OPENROUTER_API_KEY! }),
  model: 'openai/gpt-4o-mini',
});
```

## 2. Your first agent

```ts
import { agent } from '@rokkhopper/ai-sdk';

const response = await agent({
  instructions: 'You are a concise assistant.',
}).prompt('What is the capital of France?');

console.log(response.text);  // "Paris."
console.log(response.usage); // { inputTokens: 24, outputTokens: 3 }
```

## 3. Structured output

Define a schema to get back validated, typed data instead of raw text.

```ts
const review = await agent({
  instructions: 'You evaluate writing quality.',
  schema: (s) => ({
    score:    s.integer().min(1).max(10).description('Quality score').required(),
    approved: s.boolean().description('Approved if score >= 8').required(),
    issues:   s.array().items(s.string().toSchema()).required(),
  }),
}).prompt<{ score: number; approved: boolean; issues: string[] }>(
  'Evaluate: "The quick brown fox."'
);

console.log(review.structured.score);    // 7
console.log(review.structured.approved); // false
console.log(review.structured.issues);   // ['Too short', 'No context']
```

## 4. Tools

Give an agent tools. The SDK runs the **agentic loop** automatically — it calls the model, executes tool calls, feeds results back, and repeats until the model returns a final answer.

```ts
import { agent, defineTool } from '@rokkhopper/ai-sdk';

const weather = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a city.',
  schema: (s) => ({
    city: s.string().description('City name').required(),
  }),
  handle: async (input) => {
    // Replace with a real weather API call
    return `Sunny, 22°C in ${input.city}`;
  },
});

const response = await agent({
  instructions: 'Help users plan their day based on the weather.',
  tools: [weather],
}).prompt('Should I bring an umbrella in Berlin today?');

console.log(response.text);
// "No umbrella needed — it's sunny and 22°C in Berlin today!"
```

## 5. Built-in tools

Import `WebFetch` to let your agent browse URLs.

```ts
import { agent, WebFetch } from '@rokkhopper/ai-sdk';

const response = await agent({
  instructions: 'You summarize web pages in three bullet points.',
  tools: [new WebFetch()],
}).prompt('Summarize https://example.com');

console.log(response.text);
```

## 6. Prompt chaining with Pipeline

Use `Pipeline` to wire agents together sequentially.

```ts
import { agent, Pipeline } from '@rokkhopper/ai-sdk';

type Payload = { topic: string; draft: string; polished: string };

const result = await Pipeline.send<Payload>({
  topic: 'TypeScript generics',
  draft: '',
  polished: '',
})
  .through([
    async (p, next) => {
      const r = await agent({ instructions: 'You are a technical writer.' })
        .prompt(`Write a short paragraph about: ${p.topic}`);
      return next({ ...p, draft: r.text });
    },
    async (p, next) => {
      const r = await agent({ instructions: 'You polish technical writing.' })
        .prompt(`Improve clarity:\n\n${p.draft}`);
      return next({ ...p, polished: r.text });
    },
  ])
  .thenReturn();

console.log(result.polished);
```

## 7. Parallelization

Run independent agents concurrently with `Promise.all`.

```ts
const code = `function add(a, b) { return a + b; }`;

const [security, performance] = await Promise.all([
  agent({ instructions: 'Security code reviewer.' }).prompt(`Review: ${code}`),
  agent({ instructions: 'Performance expert.' }).prompt(`Review: ${code}`),
]);

const summary = await agent({ instructions: 'Tech lead synthesising reviews.' }).prompt(
  `Security: ${security.text}\nPerformance: ${performance.text}\n\nSummarise.`
);

console.log(summary.text);
```

## What's next?

- [Agents in depth →](./agents)
- [Tools in depth →](./tools)
- [All multi-agent patterns →](../patterns/overview)
- [Full API reference →](../api/agent)
