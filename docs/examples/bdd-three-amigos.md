# BDD Three Amigos

Simulate a BDD three-amigos session where a Developer, QA, and Product Owner collaborate on a user story until they reach consensus on acceptance criteria.

Uses [`refine()`](/api/refine) to drive the conversation loop. Each iteration, Dev and QA raise questions in parallel; the PO responds and signals when consensus is reached. The `previous` state guards against infinite loops if no new questions emerge.

## Full example

```ts
import { refine, skill } from '@daedalus-ai-dev/ai-sdk';
import { z } from 'zod';

// ─── Skills ──────────────────────────────────────────────────────────────────

const feedbackSchema = z.object({
  questions: z.array(z.string()),
  concerns: z.array(z.string()),
});

const devReviewer = skill({
  instructions: `
    You are a senior developer reviewing a user story in a BDD three-amigos session.
    Raise technical questions and implementation concerns.
    Be specific — vague concerns are not useful.
  `,
  output: feedbackSchema,
});

const qaReviewer = skill({
  instructions: `
    You are a QA engineer reviewing a user story in a BDD three-amigos session.
    Raise questions about edge cases, testability, and acceptance criteria gaps.
    Be specific — vague concerns are not useful.
  `,
  output: feedbackSchema,
});

const productOwner = skill({
  instructions: `
    You are a Product Owner in a BDD three-amigos session.
    Answer the developer and QA questions, resolve concerns, and update the acceptance criteria.
    Set consensus=true only when all meaningful questions and concerns have been addressed
    and the criteria are complete and unambiguous.
  `,
  output: z.object({
    answers: z.string(),
    criteria: z.array(z.string()),
    consensus: z.boolean(),
  }),
});

// ─── Three amigos loop ────────────────────────────────────────────────────────

type State = {
  story: string;
  devQuestions: string[];
  qaQuestions: string[];
  criteria: string[];
  consensus: boolean;
};

const story = `
  As a registered user, I want to reset my password via email
  so that I can regain access to my account if I forget my credentials.
`;

const { output: criteria, iterations } = await refine<State, string[]>({
  state: {
    story,
    devQuestions: [],
    qaQuestions: [],
    criteria: [],
    consensus: false,
  },

  step: async (s) => {
    // Dev and QA review in parallel
    const [devFeedback, qaFeedback] = await Promise.all([
      devReviewer.invoke({ story: s.story, currentCriteria: s.criteria }).then(r => r.structured),
      qaReviewer.invoke({ story: s.story, currentCriteria: s.criteria }).then(r => r.structured),
    ]);

    // PO answers and updates criteria
    const po = await productOwner.invoke({
      story: s.story,
      devQuestions: devFeedback.questions,
      devConcerns: devFeedback.concerns,
      qaQuestions: qaFeedback.questions,
      qaConcerns: qaFeedback.concerns,
      currentCriteria: s.criteria,
    });

    return {
      ...s,
      devQuestions: devFeedback.questions,
      qaQuestions: qaFeedback.questions,
      criteria: po.structured.criteria,
      consensus: po.structured.consensus,
    };
  },

  until: (curr, prev) => {
    // Primary exit — PO declared consensus
    if (curr.consensus) return { done: true, output: curr.criteria };

    // Safety exit — no new questions raised, loop is stuck
    const currQuestions = JSON.stringify([...curr.devQuestions, ...curr.qaQuestions].sort());
    const prevQuestions = JSON.stringify([...prev.devQuestions, ...prev.qaQuestions].sort());
    if (currQuestions === prevQuestions && curr.criteria.length > 0) {
      return { done: true, output: curr.criteria };
    }

    return { done: false };
  },

  maxIterations: 5,
});

console.log(`Consensus reached in ${iterations} round(s).\n`);
console.log('Acceptance criteria:');
criteria.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
```

## How it works

```
Round N:
  Dev  ─── questions/concerns ──► PO
  QA   ─── questions/concerns ──►
                                  PO answers, updates criteria, signals consensus
```

Dev and QA run **in parallel** each round (same input, both see the current story and criteria). The PO sees all their feedback at once and decides whether the criteria are complete.

## Stall detection

If Dev and QA raise the same questions in two consecutive rounds — meaning the PO's answers didn't produce new insights — the loop exits with the current criteria rather than spinning:

```ts
const currQuestions = JSON.stringify([...curr.devQuestions, ...curr.qaQuestions].sort());
const prevQuestions = JSON.stringify([...prev.devQuestions, ...prev.qaQuestions].sort());
if (currQuestions === prevQuestions && curr.criteria.length > 0) {
  return { done: true, output: curr.criteria };
}
```

## Output

The final output is a list of acceptance criteria in Gherkin-ready form, e.g.:

```
1. Given a registered user, when they request a password reset, then an email is sent to their registered address within 60 seconds
2. Given a reset email, when the link is clicked after 24 hours, then the link is expired and the user is shown an error
3. Given a valid reset link, when the user sets a new password, then the old password no longer works
...
```

## Tips

- Give each persona a strong system prompt with their specific lens (technical, testability, business value).
- The PO's `consensus` flag should require ALL questions to be resolved — don't let the model be too eager.
- 3–5 rounds is realistic for a well-scoped story. More suggests the story needs splitting.
