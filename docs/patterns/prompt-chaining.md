# Prompt Chaining

**Prompt chaining** breaks a complex task into a fixed sequence of steps where each agent's output becomes the next agent's input. It is the simplest multi-agent pattern and often the most reliable.

```
Input → Agent A → Agent B → Agent C → Output
```

## When to use it

- The task has a clear, predictable sequence of stages
- Each stage benefits from different instructions or a different model
- You want to validate or transform the output between stages

## Implementation with `Pipeline`

```ts
import { agent, Pipeline } from '@rokkhopper/ai-sdk';

type Payload = {
  company: string;
  role: string;
  email: string;
  review: { hasPersonalisation: boolean; toneScore: number; callToActionStrength: number } | null;
};

const result = await Pipeline.send<Payload>({
  company: 'Acme Corp',
  role: 'CTO',
  email: '',
  review: null,
})
  .through([
    // Step 1: Draft the email
    async (p, next) => {
      const r = await agent({
        instructions: 'You are an expert B2B copywriter specialising in cold outreach.',
      }).prompt(`Draft a cold email targeting the ${p.role} at ${p.company}.`);
      return next({ ...p, email: r.text });
    },

    // Step 2: Review it (structured output)
    async (p, next) => {
      const r = await agent({
        instructions: 'You are a cold email quality analyst.',
        schema: (s) => ({
          hasPersonalisation:      s.boolean().required(),
          toneScore:               s.integer().min(1).max(10).required(),
          callToActionStrength:    s.integer().min(1).max(10).required(),
        }),
      }).prompt<{ hasPersonalisation: boolean; toneScore: number; callToActionStrength: number }>(
        p.email
      );
      return next({ ...p, review: r.structured });
    },

    // Step 3: Improve based on review
    async (p, next) => {
      const feedback = `
        Personalisation: ${p.review!.hasPersonalisation ? 'good' : 'needs improvement'}
        Tone score: ${p.review!.toneScore}/10
        CTA strength: ${p.review!.callToActionStrength}/10
      `;
      const r = await agent({
        instructions: 'You improve cold emails based on quality feedback.',
      }).prompt(`Improve this email:\n\n${p.email}\n\nFeedback:\n${feedback}`);
      return next({ ...p, email: r.text });
    },
  ])
  .thenReturn();

console.log(result.email);
```

## Conditional branching

A pipeline step can short-circuit by not calling `next()`:

```ts
.through([
  async (p, next) => {
    if (p.review?.toneScore >= 9 && p.review?.callToActionStrength >= 9) {
      // Quality bar already met — skip improvement step
      return p;
    }
    return next(p);
  },
  async (p, next) => {
    // Improvement step — only runs if previous step called next()
    const r = await agent({ instructions: 'Polish the email.' }).prompt(p.email);
    return next({ ...p, email: r.text });
  },
])
```

## Without Pipeline

You can also chain agents manually using plain async/await:

```ts
// Step 1
const draft = await agent({ instructions: 'Technical writer.' })
  .prompt(`Write about: ${topic}`);

// Step 2 — uses draft.text as input
const translated = await agent({ instructions: 'Spanish translator.' })
  .prompt(`Translate to Spanish:\n\n${draft.text}`);

// Step 3 — uses translated.text as input
const formatted = await agent({ instructions: 'Markdown formatter.' })
  .prompt(`Format as a blog post:\n\n${translated.text}`);

console.log(formatted.text);
```

`Pipeline` is just a convenience wrapper — use whichever style fits your codebase.

## Tips

- **Keep steps small.** Each step should do one thing. Monolithic prompts are hard to debug.
- **Validate between steps.** Use structured output on intermediate steps to catch problems early.
- **Log each step's output.** Store `response.messages` per step for debugging.
- **Use cheaper models for simple steps.** Routing, extraction, and formatting rarely need the most powerful model.
