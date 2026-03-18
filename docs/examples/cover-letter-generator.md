# Example: Cover Letter Generator

**Pattern:** [Evaluator-Optimizer](../patterns/evaluator-optimizer)

Generates a tailored cover letter for a job application, then iteratively improves it against a structured rubric until it meets the quality bar or hits the iteration limit.

```
Resume + Job Description → Generator → Evaluator ─── approved? ──► Final letter
                                            │
                                            No (with feedback)
                                            ▼
                                        Rewriter ──────────────► (repeat)
```

## Full example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';

const provider = anthropic('claude-opus-4-6');

type Evaluation = {
  scores: {
    relevance: number;       // Does it address the specific role and company?
    specificity: number;     // Are claims backed by concrete achievements?
    tone: number;            // Professional but not generic?
    callToAction: number;    // Does it end with a clear next step?
  };
  approved: boolean;         // true if all scores >= 7
  improvements: string[];    // Specific, actionable improvement instructions
};

const resume = `
Jane Smith | jane@example.com | github.com/janesmith

EXPERIENCE
Senior Software Engineer, Stripe (2021–present)
- Led migration of payment webhook system handling 50M events/day to event-sourced architecture
- Reduced p99 latency by 40% through connection pool optimisation
- Mentored 3 junior engineers; ran weekly architecture reviews

Software Engineer, Shopify (2018–2021)
- Built real-time inventory sync service (TypeScript, Kafka)
- Shipped storefront A/B testing framework used by 10,000+ merchants

SKILLS: TypeScript, Go, PostgreSQL, Kafka, AWS, distributed systems
EDUCATION: B.Sc. Computer Science, University of Toronto, 2018
`.trim();

const jobDescription = `
Staff Engineer — Platform Infrastructure
Vercel

We're looking for a Staff Engineer to join our Platform Infrastructure team.
You'll design and scale the systems that serve 1M+ developer deployments per day.

Responsibilities:
- Design high-throughput, low-latency infrastructure services
- Partner with product teams to define platform APIs
- Mentor senior engineers and drive technical decisions across teams

Requirements:
- 7+ years of software engineering experience
- Deep expertise in distributed systems and high-throughput event processing
- Experience leading cross-functional technical initiatives
- Strong communication skills — you write RFCs and run design reviews
`.trim();

// ─── Step 1: Initial draft ────────────────────────────────────────────────────

let letter = (await agent({
  provider,
  instructions: `You write compelling, personalised cover letters for software engineers.
Rules:
- 3–4 paragraphs, under 400 words
- Open with a specific hook about the company, not "I am writing to apply for..."
- Match concrete resume achievements to specific job requirements
- Close with a clear, confident call to action
- Never use phrases like "I am passionate about" or "I believe I would be a great fit"`,
}).prompt(
  `Write a cover letter.\n\nRESUME:\n${resume}\n\nJOB DESCRIPTION:\n${jobDescription}`
)).text;

console.log('── Initial draft ──────────────────────────────');
console.log(letter);

// ─── Evaluate-improve loop ────────────────────────────────────────────────────

const MAX_ITERATIONS = 4;
const PASS_THRESHOLD = 7;

for (let i = 0; i < MAX_ITERATIONS; i++) {
  const evaluation = await agent({
    provider,
    instructions: `You evaluate cover letters against a strict rubric. Be critical and specific.
A score of 7+ means "good enough to send". Lower means there's a clear problem to fix.`,
    schema: (s) => ({
      scores: s.array()
        .items(s.string().toSchema())
        .description('DO NOT USE — see individual score fields').required(),
      relevance: s.integer().min(1).max(10)
        .description('Does it directly address this specific role and company? 1=generic, 10=highly tailored')
        .required(),
      specificity: s.integer().min(1).max(10)
        .description('Are achievements cited with concrete metrics and outcomes? 1=vague claims, 10=precise data')
        .required(),
      tone: s.integer().min(1).max(10)
        .description('Professional, confident, and distinctive? 1=generic/clichéd, 10=memorable voice')
        .required(),
      callToAction: s.integer().min(1).max(10)
        .description('Does it close with a specific, confident next step? 1=passive, 10=clear and direct')
        .required(),
      approved: s.boolean()
        .description('true only if ALL scores are >= 7')
        .required(),
      improvements: s.array()
        .items(s.string().toSchema())
        .description('Specific rewrite instructions. Empty if approved.')
        .required(),
    }),
  }).prompt<Evaluation & { relevance: number; specificity: number; tone: number; callToAction: number }>(
    `Evaluate this cover letter for the following job.\n\nJOB:\n${jobDescription}\n\nLETTER:\n${letter}`
  );

  // Normalise structured output
  const scores = {
    relevance: (evaluation.structured as Record<string, number>).relevance,
    specificity: (evaluation.structured as Record<string, number>).specificity,
    tone: (evaluation.structured as Record<string, number>).tone,
    callToAction: (evaluation.structured as Record<string, number>).callToAction,
  };

  const allPassing = Object.values(scores).every((s) => s >= PASS_THRESHOLD);

  console.log(`\n── Iteration ${i + 1} evaluation ────────────────────`);
  Object.entries(scores).forEach(([k, v]) => {
    const bar = '█'.repeat(v) + '░'.repeat(10 - v);
    const status = v >= PASS_THRESHOLD ? '✓' : '✗';
    console.log(`  ${status} ${k.padEnd(14)} ${bar} ${v}/10`);
  });

  if (allPassing) {
    console.log('\n✓ Quality bar met — letter approved.');
    break;
  }

  if (evaluation.structured.improvements.length === 0) {
    console.log('\nNo specific improvements given — stopping.');
    break;
  }

  console.log('\nImprovements:');
  evaluation.structured.improvements.forEach((imp, idx) => {
    console.log(`  ${idx + 1}. ${imp}`);
  });

  // Rewrite with specific feedback
  letter = (await agent({
    provider,
    instructions: `You rewrite cover letters based on specific feedback.
Apply every instruction exactly. Do not add content not implied by the feedback.
Keep the length under 400 words.`,
  }).prompt(
    `Rewrite this cover letter applying these improvements:\n\n${evaluation.structured.improvements.map((imp, i) => `${i + 1}. ${imp}`).join('\n')}\n\nCurrent letter:\n${letter}`
  )).text;
}

// ─── Final output ─────────────────────────────────────────────────────────────

console.log('\n══ Final Cover Letter ═════════════════════════');
console.log(letter);
```

## Why this structure works

- **Rubric-driven evaluation.** Each dimension (relevance, specificity, tone, CTA) has a clear 1–10 scale definition — the evaluator can't give vague feedback like "make it better".
- **Actionable improvements.** The `improvements` field forces the evaluator to return specific rewrite instructions, not scores alone. The rewriter receives a numbered list, not prose.
- **Separate generator and rewriter.** The initial draft is written fresh; rewrites receive explicit feedback. This avoids the model "defending" its own output.
- **Hard iteration cap.** `MAX_ITERATIONS = 4` prevents the loop from running indefinitely if the evaluator keeps finding minor issues.

## Variations

**Human-in-the-loop approval:**

```ts
// Replace the approved flag with a prompt to the user
const { approved } = await askUser(
  `Score: ${JSON.stringify(scores)}\n\nApprove this letter? (y/n)`
);
```

**Stricter bar for senior roles:**

```ts
const PASS_THRESHOLD = role.level === 'staff' ? 9 : 7;
```

**Export to PDF after approval:**

```ts
import { jsPDF } from 'jspdf';
const doc = new jsPDF();
doc.text(letter, 20, 20);
doc.save('cover-letter.pdf');
```
