# Blog Review Workflow

Run three specialist reviewers in parallel, synthesize their feedback with an AI accumulator, then produce a final edited post — all in a single typed pipeline using [`workflow()`](/api/workflow).

## The shape

```
Post ──► tone-reviewer    ─┐
     ──► tech-reviewer    ─┼─► synthesizer ──► editor ──► EditedPost
     ──► seo-reviewer     ─┘
         (parallel)            (accumulate)   (serial)
```

Two stages:
1. **Parallel** — three reviewers each receive the same post and return independent feedback
2. **Serial** — an editor receives the synthesized report and rewrites the post

## Full example

```ts
import { workflow, fromSkill, skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

// ─── Output schemas ───────────────────────────────────────────────────────────

const reviewSchema = z.object({
  score: z.number().min(0).max(10),
  strengths: z.array(z.string()),
  suggestions: z.array(z.string()),
});

const reportSchema = z.object({
  overallScore: z.number().min(0).max(10),
  summary: z.string(),
  topSuggestions: z.array(z.string()).max(5),
});

const editedSchema = z.object({
  title: z.string(),
  body: z.string(),
  changesSummary: z.string(),
});

// ─── Skills ───────────────────────────────────────────────────────────────────

type Post = { title: string; body: string };
type Review = z.infer<typeof reviewSchema>;
type Report = z.infer<typeof reportSchema>;
type EditedPost = z.infer<typeof editedSchema>;

const toneReviewer = skill<Post, Review>({
  instructions: 'Review the tone and voice of this blog post. Is it engaging, consistent, and appropriate for the audience?',
  output: reviewSchema,
});

const techReviewer = skill<Post, Review>({
  instructions: 'Review the technical accuracy of this blog post. Check facts, code examples, and terminology.',
  output: reviewSchema,
});

const seoReviewer = skill<Post, Review>({
  instructions: 'Review the SEO quality of this blog post. Evaluate title, headings, keyword usage, and meta-description potential.',
  output: reviewSchema,
});

const synthesizer = skill<Review[], Report>({
  instructions: 'You receive an array of expert reviews. Synthesize them into a single actionable report with an overall score and the top suggestions.',
  output: reportSchema,
});

const editor = skill<Report, EditedPost>({
  instructions: 'Rewrite the blog post based on the review report. Apply the top suggestions and summarise what you changed.',
  output: editedSchema,
  // Template to give the editor both the report AND the original post
  template: ({ report, post }: any) =>
    `## Review report\n${JSON.stringify(report, null, 2)}\n\n## Original post\nTitle: ${post.title}\n\n${post.body}`,
});

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const reviewPipeline = workflow<Post>()
  .parallel({
    steps: [
      fromSkill('tone-reviewer', toneReviewer),
      fromSkill('tech-reviewer', techReviewer),
      fromSkill('seo-reviewer',  seoReviewer),
    ],
    accumulate: async (reviews) => (await synthesizer.invoke(reviews)).structured,
  })
  .step({
    name: 'editor',
    run: async (report) => {
      // We need both the report and the original post for the editor.
      // Store the post in closure scope (see note below).
      return (await editor.invoke({ report } as any)).structured;
    },
  })
  .build();

// ─── Run ──────────────────────────────────────────────────────────────────────

const post: Post = {
  title: 'Getting Started with TypeScript Generics',
  body: `
TypeScript generics allow you to write reusable, type-safe code.
A generic function works with any type while preserving type information...
  `.trim(),
};

const { output, stages } = await reviewPipeline.run(post);

console.log('Edited title:', output.title);
console.log('Changes made:', output.changesSummary);
console.log(`\nStage timings:`);
stages.forEach((s) =>
  console.log(`  ${s.type}${s.name ? ` (${s.name})` : ''}: ${s.durationMs}ms`),
);
```

## Passing context across stages

The parallel stage outputs `Report` — but the editor needs both the `Report` **and** the original `Post`. The cleanest way is to carry the post in the accumulated output:

```ts
// Extend the accumulator to include the post
const synthesizer = skill<{ reviews: Review[]; post: Post }, Report & { post: Post }>({
  instructions: 'Synthesize reviews. Also pass the original post through in your response.',
  output: reportSchema.extend({ post: z.object({ title: z.string(), body: z.string() }) }),
});

// Then the accumulate step has access to both
accumulate: async (results) => {
  const report = (await synthesizer.invoke({ reviews: results, post })).structured;
  return { ...report, post };   // { overallScore, summary, topSuggestions, post }
},
```

## Stage timings

`workflow().build().run()` returns a `stages` array with `durationMs` per stage:

```
Stage timings:
  parallel: 2341ms      ← three reviewers ran concurrently
  serial (editor): 891ms
```

The parallel stage wall-clock time equals the **slowest** of the three reviewers, not their sum — which is the whole point.

## With `configure({ debug: true })`

Enable [debug mode](/api/configure#debug) to see every skill invocation, token count, and stage timing in your terminal:

```
▸ workflow  parallel  [tone-reviewer, tech-reviewer, seo-reviewer]
▸ skill  Review the tone and voice...
  ⟶  {"title":"Getting Started...","body":"TypeScript generics..."}
  ...
▸ skill  Review the technical accuracy...
  ...
▸ workflow  ✓  2.3s

▸ workflow  serial  editor
▸ skill  Rewrite the blog post...
  ...
▸ workflow  ✓  891ms
```
