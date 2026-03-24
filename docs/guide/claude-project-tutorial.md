# Building a Blog Review Pipeline with Claude

This guide walks through building a real content review tool step by step — the kind of thing you'd actually ship. By the end you'll have a multi-agent pipeline that reviews a blog draft for clarity, SEO, and tone, then consolidates the findings into an editorial report.

We'll use Claude via Anthropic's API and store all agent behaviour as markdown files so the prompts stay readable and easy to iterate on without touching TypeScript.

## Prerequisites

You need an Anthropic API key. If you don't have one, get it at [console.anthropic.com](https://console.anthropic.com).

## Setup

```bash
npm install @daedalus-ai-dev/ai-sdk
```

Set your key as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Step 1: Configure Claude

Create your entry point and wire up the provider:

```ts
// src/index.ts
import { configure, anthropic } from '@daedalus-ai-dev/ai-sdk';

configure({
  provider: anthropic('claude-3-5-sonnet-20241022'),
});
```

`configure()` sets the global default. Every agent you create after this will use Claude 3.5 Sonnet unless you override `model` in its frontmatter.

## Step 2: Define shared behaviour as skills

The three reviewers all share the same professional voice and output format. Rather than copy-pasting those instructions into each agent, pull them out into skills.

Create a `skills/` directory:

**`skills/editor-voice.md`**

```markdown
---
name: editor-voice
description: Professional editorial tone
---
You are a professional editor. Be direct and constructive — point out specific
issues with concrete suggestions for improvement. Never pad feedback with praise
for its own sake. When something is good, say nothing and move on.
```

**`skills/review-format.md`**

```markdown
---
name: review-format
description: Structured review output format
---
Format your review as a short list of findings. Each finding must have:
- A one-line summary
- The specific excerpt that prompted it (quote it exactly)
- A concrete suggestion for how to fix it

End with an overall verdict: APPROVE, REVISE, or REJECT.
```

## Step 3: Create the reviewer agents

Each reviewer is a focused specialist. The skills handle the shared boilerplate so each agent file only contains the domain-specific instructions.

**`agents/clarity-reviewer.md`**

```markdown
---
name: clarity-reviewer
model: anthropic/claude-3-5-sonnet
---
You review blog posts for clarity and readability.

Look for: jargon without explanation, sentences that require re-reading,
paragraphs that try to make more than one point, and missing transitions
between ideas.

{{skill:editor-voice}}
{{skill:review-format}}
```

**`agents/seo-reviewer.md`**

```markdown
---
name: seo-reviewer
model: anthropic/claude-3-5-sonnet
---
You review blog posts for SEO effectiveness.

Look for: missing or weak title and meta description, keyword stuffing or
absence, lack of header hierarchy, thin sections that won't rank, and
missing internal/external links.

{{skill:editor-voice}}
{{skill:review-format}}
```

**`agents/tone-reviewer.md`**

```markdown
---
name: tone-reviewer
model: anthropic/claude-3-5-sonnet
---
You review blog posts for tone and audience fit. The target audience is
senior software engineers who value precision over enthusiasm.

Look for: marketing language, vague superlatives ("amazing", "powerful"),
passive voice overuse, and any condescension toward the reader.

{{skill:editor-voice}}
{{skill:review-format}}
```

## Step 4: Add the editorial orchestrator

The orchestrator runs all three reviewers and consolidates their findings. It receives the full draft plus the three review reports and produces a single editorial decision.

**`agents/editorial-orchestrator.md`**

```markdown
---
name: editorial-orchestrator
model: anthropic/claude-opus-4-6
tools: [delegate_to_clarity-reviewer, delegate_to_seo-reviewer, delegate_to_tone-reviewer]
maxIterations: 6
schema:
  verdict: string!
  summary: string!
  priority_fixes: string[]!
  approved: boolean!
---
You are an editorial director. You coordinate a team of specialist reviewers
and make the final call on whether a blog post is ready to publish.

Process:
1. Send the draft to all three reviewers simultaneously by calling each tool.
2. Read their findings carefully.
3. Produce a consolidated report with a final verdict.

A post is APPROVED if it has no REJECT verdicts and at most two REVISE verdicts
with minor issues. Otherwise, request revisions.
```

::: tip Why Opus for the orchestrator?
The orchestrator does synthesis and judgement, not mechanical review. Claude Opus 4.6 is worth the extra cost here — the workers do the heavy lifting cheaply, the orchestrator just reasons about their output.
:::

## Step 5: Wire it together

```ts
// src/review.ts
import {
  configure,
  anthropic,
  loadSkillsFrom,
  loadAgentsFrom,
  getAgent,
  agentTool,
} from '@daedalus-ai-dev/ai-sdk';
import { readFile } from 'node:fs/promises';

configure({
  provider: anthropic('claude-3-5-sonnet-20241022'),
});

async function reviewPost(draftPath: string) {
  // 1. Load skills first — agents reference them
  await loadSkillsFrom('./skills');

  // 2. Load the reviewer agents (no tools needed)
  await loadAgentsFrom('./agents');

  // 3. The orchestrator's tools are the reviewer agents
  //    agentTool() creates a Tool that delegates to a registered agent
  await loadAgentsFrom('./agents', {
    tools: {
      'delegate_to_clarity-reviewer': agentTool('clarity-reviewer'),
      'delegate_to_seo-reviewer':     agentTool('seo-reviewer'),
      'delegate_to_tone-reviewer':    agentTool('tone-reviewer'),
    },
  });

  const draft = await readFile(draftPath, 'utf-8');

  const result = await getAgent('editorial-orchestrator')
    .prompt<{
      verdict: string;
      summary: string;
      priority_fixes: string[];
      approved: boolean;
    }>(`Please review this blog post draft:\n\n${draft}`);

  return result.structured;
}

// Run it
const report = await reviewPost('./drafts/typescript-generics.md');

console.log(`Verdict: ${report.verdict}`);
console.log(`Approved: ${report.approved}`);
console.log(`\nSummary:\n${report.summary}`);
console.log(`\nPriority fixes:`);
report.priority_fixes.forEach((fix, i) => console.log(`  ${i + 1}. ${fix}`));
```

Running it:

```bash
npx tsx src/review.ts
```

Output:

```
Verdict: REVISE
Approved: false

Summary:
The post has strong technical content but consistently uses marketing language
that will alienate the target audience. The SEO structure is solid. Clarity
issues are minor and easily fixed.

Priority fixes:
  1. Replace "powerful generics system" with a concrete description of what
     generics actually let you do.
  2. Break the third section into two — it conflates variance and constraints.
  3. Add a meta description targeting "TypeScript generics tutorial".
```

## Step 6: Iterate on prompts without touching code

This is where markdown agents pay off. Say the tone reviewer is flagging too many things as marketing language. You can open `agents/tone-reviewer.md`, adjust the instructions, and re-run — no TypeScript changes, no recompilation.

You can also let a non-engineer teammate own the prompt files. They can tune the review criteria, adjust the output format in the skill, or change the approval threshold in the orchestrator — all without ever opening the codebase.

## What's next?

- Add a `WebFetch` tool to let the SEO reviewer check competitor rankings
- Stream the orchestrator output for a real-time dashboard with `.stream()`
- Persist `result.checkpoint` to resume a failed run without re-running all reviewers
- Add a [Pipeline](../api/pipeline) step before the review to auto-generate a meta description
