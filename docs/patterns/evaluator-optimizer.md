# Evaluator-Optimizer

The **evaluator-optimizer** pattern generates output, evaluates it against a quality bar, and iteratively improves it until the bar is met (or a maximum number of attempts is reached).

```
Input → Generator → Evaluator → approved? ──Yes──► Output
                        │
                        No
                        ▼
                    Improver ──────────────────────► (repeat)
```

::: tip Use `refine()` for this pattern
The SDK ships a first-class primitive for this loop: [`refine()`](/api/refine).
It handles the iteration counter, max-iterations ceiling, and — uniquely — exposes the **previous state** to the exit condition so you can detect when the model has stopped making progress and bail early.

See the ready-to-run examples:
- [TDD Code Generator](/examples/tdd-code-generator) — red/green/refactor loop
- [BDD Three Amigos](/examples/bdd-three-amigos) — consensus loop with parallel Dev + QA roles
:::

## When to use it

- The quality of the output can be assessed by another LLM or a programmatic check
- A single generation rarely hits the quality bar
- The improvement process is well-defined (the evaluator can give actionable feedback)

## Basic example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

const topic = 'the importance of type safety in TypeScript';
const MAX_ITERATIONS = 3;

type Evaluation = {
  score: number;
  approved: boolean;
  issues: string[];
};

// Initial draft
let content = (await agent({
  instructions: 'You are a clear and concise technical writer.',
}).prompt(`Write a short paragraph about: ${topic}`)).text;

// Evaluate-improve loop
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const evaluation = await agent({
    instructions: `You are a writing quality evaluator. Criteria:
      - Technical accuracy
      - Clarity and readability
      - Concrete examples
      Mark approved if score >= 8.`,
    schema: (s) => ({
      score:    s.integer().min(1).max(10).description('Overall quality score').required(),
      approved: s.boolean().description('true if score >= 8').required(),
      issues:   s.array().items(s.string().toSchema()).description('Specific issues to fix').required(),
    }),
  }).prompt<Evaluation>(`Evaluate this paragraph:\n\n${content}`);

  console.log(`Iteration ${i + 1}: score ${evaluation.structured.score}/10`);

  if (evaluation.structured.approved) {
    console.log('Quality bar met!');
    break;
  }

  const issues = evaluation.structured.issues.join('\n- ');
  content = (await agent({
    instructions: 'You improve technical writing based on specific feedback.',
  }).prompt(`Rewrite fixing these issues:\n- ${issues}\n\nOriginal:\n${content}`)).text;
}

console.log('\nFinal content:\n', content);
```

## Programmatic evaluation

The evaluator does not have to be an LLM. Combine LLM generation with deterministic checks:

```ts
function evaluateCode(code: string): { approved: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!code.includes('try') && !code.includes('catch')) {
    issues.push('Missing error handling');
  }
  if (code.includes('any')) {
    issues.push('Avoid using `any` type');
  }
  if (!code.includes('export')) {
    issues.push('Functions should be exported');
  }

  return { approved: issues.length === 0, issues };
}

let code = (await agent({
  instructions: 'Write TypeScript code.',
}).prompt(`Implement: ${specification}`)).text;

for (let i = 0; i < 3; i++) {
  const { approved, issues } = evaluateCode(code);
  if (approved) break;

  code = (await agent({
    instructions: 'You fix TypeScript code quality issues.',
  }).prompt(`Fix these issues:\n- ${issues.join('\n- ')}\n\nCode:\n${code}`)).text;
}
```

## Translation evaluation with back-translation

A classic technique: translate, then back-translate and compare with the original:

```ts
const original = 'The quick brown fox jumps over the lazy dog.';

// Translate
let translated = (await agent({
  instructions: 'You are a professional Spanish translator.',
}).prompt(`Translate to Spanish: "${original}"`)).text;

for (let i = 0; i < 3; i++) {
  // Back-translate to evaluate fidelity
  const backTranslated = (await agent({
    instructions: 'You translate Spanish to English.',
  }).prompt(`Translate to English: "${translated}"`)).text;

  const evaluation = await agent({
    instructions: 'Compare two sentences for semantic equivalence.',
    schema: (s) => ({
      equivalent: s.boolean().required(),
      lostMeaning: s.array().items(s.string().toSchema()).required(),
    }),
  }).prompt<{ equivalent: boolean; lostMeaning: string[] }>(`
    Original: "${original}"
    Back-translated: "${backTranslated}"
    Are they semantically equivalent?
  `);

  if (evaluation.structured.equivalent) break;

  const feedback = evaluation.structured.lostMeaning.join(', ');
  translated = (await agent({
    instructions: 'You are a professional Spanish translator. Preserve meaning precisely.',
  }).prompt(`Improve this translation. Lost meaning: ${feedback}\n\nCurrent: "${translated}"`)).text;
}

console.log('Final translation:', translated);
```

## Stopping conditions

Always define clear stopping conditions to avoid infinite loops:

| Condition | Approach |
|-----------|----------|
| Quality score threshold | `if (score >= 8) break` |
| LLM `approved` flag | `if (evaluation.approved) break` |
| Programmatic check passes | `if (linter.check(code).ok) break` |
| Max iterations reached | `for` loop with bounded `MAX_ITERATIONS` |
| Diminishing improvements | Track score delta; stop if `score[i] - score[i-1] < 0.5` |

## Tips

- **Give the evaluator a rubric.** Vague evaluation criteria ("is it good?") produce inconsistent scores.
- **Return actionable feedback.** "Improve clarity" is less useful than "the third sentence is ambiguous — specify which variable is being referenced."
- **Track improvement per iteration.** Log `score` over time — if it plateaus, the prompt may need rethinking.
- **Cap iterations conservatively.** 3–5 iterations is usually enough. More rarely helps and multiplies cost.
- **Consider caching.** If the same draft is evaluated multiple times with no change, deduplicate.
