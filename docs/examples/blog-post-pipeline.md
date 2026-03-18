# Example: Blog Post Pipeline

**Pattern:** [Prompt Chaining](../patterns/prompt-chaining)

A five-step pipeline that takes a topic and produces a fully written, SEO-optimised blog post with a meta description. Each step has a narrowly scoped instruction so the model focuses on one thing at a time.

```
Topic → Research Questions → Outline → Draft → Polish → SEO Meta
```

## Full example

```ts
import { agent, Pipeline } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';

type PostPayload = {
  topic: string;
  audience: string;
  researchQuestions: string[];
  outline: string;
  draft: string;
  polished: string;
  seo: { title: string; metaDescription: string; keywords: string[] } | null;
};

const provider = anthropic('claude-opus-4-6');

const post = await Pipeline.send<PostPayload>({
  topic: 'Why TypeScript is worth the initial setup cost',
  audience: 'JavaScript developers considering adopting TypeScript',
  researchQuestions: [],
  outline: '',
  draft: '',
  polished: '',
  seo: null,
})
  .through([

    // Step 1 — Generate targeted research questions
    async (p, next) => {
      const r = await agent({
        provider,
        instructions: 'You identify what a reader needs to know to be convinced by a blog post.',
        schema: (s) => ({
          questions: s.array()
            .items(s.string().toSchema())
            .description('5–7 research questions the post must answer')
            .required(),
        }),
      }).prompt<{ questions: string[] }>(
        `Topic: "${p.topic}"\nAudience: ${p.audience}\n\nWhat key questions must this post answer?`
      );
      console.log('✓ Research questions generated');
      return next({ ...p, researchQuestions: r.structured.questions });
    },

    // Step 2 — Build a structured outline
    async (p, next) => {
      const r = await agent({
        provider,
        instructions: 'You are a content strategist. Write clear, structured blog outlines.',
      }).prompt(
        `Write a detailed outline for a blog post on: "${p.topic}"\n\nAudience: ${p.audience}\n\nMust address:\n${p.researchQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      );
      console.log('✓ Outline complete');
      return next({ ...p, outline: r.text });
    },

    // Step 3 — Write the full draft
    async (p, next) => {
      const r = await agent({
        provider,
        instructions: `You are an experienced technical blogger. Write in an approachable but precise style.
Rules:
- Use concrete code examples where helpful
- Avoid filler phrases like "In conclusion" or "It's worth noting"
- Target 800–1200 words
- Write for: ${p.audience}`,
      }).prompt(
        `Write the full blog post following this outline:\n\n${p.outline}`
      );
      console.log('✓ Draft written');
      return next({ ...p, draft: r.text });
    },

    // Step 4 — Polish for clarity and flow
    async (p, next) => {
      const r = await agent({
        provider,
        instructions: `You are a copy editor. Polish blog posts for:
- Clear sentence structure (no run-ons)
- Consistent voice and tense
- Strong opening and closing paragraphs
- Removed fluff and redundancy
Do NOT change technical accuracy or add new content.`,
      }).prompt(
        `Edit this blog post:\n\n${p.draft}`
      );
      console.log('✓ Post polished');
      return next({ ...p, polished: r.text });
    },

    // Step 5 — Generate SEO metadata
    async (p, next) => {
      const r = await agent({
        provider,
        instructions: 'You write SEO metadata that accurately reflects content and maximises click-through rate.',
        schema: (s) => ({
          title: s.string()
            .description('SEO title, 50–60 characters, includes primary keyword')
            .required(),
          metaDescription: s.string()
            .description('Meta description, 150–160 characters, includes a call to action')
            .required(),
          keywords: s.array()
            .items(s.string().toSchema())
            .description('5–8 target keywords')
            .required(),
        }),
      }).prompt<{ title: string; metaDescription: string; keywords: string[] }>(
        `Generate SEO metadata for this post:\n\n${p.polished}`
      );
      console.log('✓ SEO metadata ready');
      return next({ ...p, seo: r.structured });
    },

  ])
  .thenReturn();

// Output
console.log('\n──────────────────────────────────────');
console.log(`Title:            ${post.seo?.title}`);
console.log(`Meta description: ${post.seo?.metaDescription}`);
console.log(`Keywords:         ${post.seo?.keywords.join(', ')}`);
console.log('\n─── POST ─────────────────────────────');
console.log(post.polished);
```

## Why this structure works

- **One concern per step.** Each agent only thinks about its narrow job — the drafter doesn't worry about SEO, the editor doesn't restructure the outline.
- **Structured output on critical steps.** The research questions and SEO metadata steps use schemas so downstream steps receive typed data, not free-form text to parse.
- **Easy to swap models per step.** The drafting step uses a powerful model; a cheaper model like `claude-haiku-4-5` is more than sufficient for the SEO step.

## Variations

**Stream the final post to the terminal:**

```ts
for await (const chunk of agent({ provider, instructions: '...' }).stream(prompt)) {
  process.stdout.write(chunk);
}
```

**Skip the polish step if the draft is already short:**

```ts
async (p, next) => {
  if (p.draft.length < 2000) return next(p); // skip polish for short posts
  const r = await agent({ ... }).prompt(p.draft);
  return next({ ...p, polished: r.text });
},
```
