# Parallelization

**Parallelization** runs independent agents simultaneously and combines their results. Use standard `Promise.all` — no special SDK API is needed.

```
          ┌─► Agent A ─┐
Input ───►│─► Agent B ─├─► Synthesizer → Output
          └─► Agent C ─┘
```

## When to use it

- Sub-tasks are independent (no data dependency between them)
- You want multiple perspectives on the same input (e.g., code review)
- Latency matters — parallel > sequential when tasks don't depend on each other

## Basic example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

const code = `
function processPayment(amount: number, card: string) {
  const query = \`UPDATE accounts SET balance = balance - \${amount}\`;
  db.execute(query + " WHERE card = " + card);
}
`;

// Run three reviewers in parallel
const [security, performance, maintainability] = await Promise.all([
  agent({
    instructions: 'You are a security expert. Find vulnerabilities and suggest fixes.',
  }).prompt(`Review this code for security issues:\n\`\`\`ts\n${code}\n\`\`\``),

  agent({
    instructions: 'You are a performance engineer. Identify bottlenecks and optimisation opportunities.',
  }).prompt(`Review this code for performance:\n\`\`\`ts\n${code}\n\`\`\``),

  agent({
    instructions: 'You are a software architect. Evaluate readability, maintainability, and design patterns.',
  }).prompt(`Review this code for maintainability:\n\`\`\`ts\n${code}\n\`\`\``),
]);

// Synthesize into a single report
const report = await agent({
  instructions: 'You are a tech lead synthesising code review feedback into an actionable summary.',
}).prompt(`
Summarise these code reviews into a prioritised action list:

**Security Review:**
${security.text}

**Performance Review:**
${performance.text}

**Maintainability Review:**
${maintainability.text}
`);

console.log(report.text);
```

## Voting / consensus

Run the same prompt multiple times and take the majority answer — useful for high-stakes decisions:

```ts
const RUNS = 5;

const votes = await Promise.all(
  Array.from({ length: RUNS }, () =>
    agent({
      instructions: 'You classify support tickets. Respond with exactly one word.',
      schema: (s) => ({
        category: s.enum(['billing', 'technical', 'general']).required(),
      }),
    }).prompt<{ category: string }>(`Classify: "${ticket}"`),
  ),
);

// Count votes
const counts = votes.reduce<Record<string, number>>((acc, r) => {
  acc[r.structured.category] = (acc[r.structured.category] ?? 0) + 1;
  return acc;
}, {});

const winner = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]![0];
console.log(`Classification: ${winner} (${counts[winner]}/${RUNS} votes)`);
```

## Map-reduce over large inputs

Process many items in parallel, then aggregate:

```ts
const articles = await fetchArticles(); // returns Article[]

// Map: summarise each article in parallel (batch to avoid rate limits)
const BATCH_SIZE = 10;
const summaries: string[] = [];

for (let i = 0; i < articles.length; i += BATCH_SIZE) {
  const batch = articles.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.all(
    batch.map((article) =>
      agent({ instructions: 'Summarise in 2 sentences.' })
        .prompt(article.content)
        .then((r) => r.text),
    ),
  );
  summaries.push(...batchResults);
}

// Reduce: synthesise all summaries
const digest = await agent({
  instructions: 'You produce a weekly news digest from article summaries.',
}).prompt(`Create a digest from these ${summaries.length} summaries:\n\n${summaries.join('\n\n')}`);

console.log(digest.text);
```

## Rate limit considerations

Most AI providers rate-limit by requests-per-minute. Parallelizing too aggressively can trigger 429 errors. Strategies:

- **Batch processing** — process N items at a time (see map-reduce example above)
- **Exponential backoff** — retry with delay on rate limit errors
- **Concurrency limiter** — use a library like `p-limit` to cap parallel requests:

```ts
import pLimit from 'p-limit';

const limit = pLimit(5); // max 5 concurrent requests

const results = await Promise.all(
  items.map((item) =>
    limit(() => agent({ instructions: '...' }).prompt(item)),
  ),
);
```

## Tips

- **Ensure true independence.** If Agent B needs Agent A's output, use [Prompt Chaining](./prompt-chaining) instead.
- **Collect costs.** Sum `response.usage` across all parallel calls to track the true cost of one workflow.
- **Timeout protection.** Wrap `Promise.all` with `Promise.race` and a timeout if latency SLAs are strict.
