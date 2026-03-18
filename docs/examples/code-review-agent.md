# Example: Automated Code Review Agent

**Pattern:** [Orchestrator-Workers](../patterns/orchestrator-workers)

A code review orchestrator that receives a pull request diff, dynamically decides which specialist reviews to run, and produces a structured PR comment. The orchestrator is not following a fixed script — it reads the diff and decides what to check.

```
PR Diff → Orchestrator → security_review(file)   ─┐
                       → performance_review(file) ─┤
                       → style_review(file)       ─┤→ write_summary()
                       → suggest_tests(file)      ─┘
```

## Full example

```ts
import { agent, defineTool } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';

type ReviewComment = {
  severity: 'critical' | 'warning' | 'suggestion';
  file: string;
  line?: number;
  title: string;
  description: string;
  fix?: string;
};

type ReviewSummary = {
  approved: boolean;
  blockers: number;
  warnings: number;
  suggestions: number;
  summary: string;
};

// ─── Shared result collector ──────────────────────────────────────────────────

const comments: ReviewComment[] = [];

// ─── Worker tools ─────────────────────────────────────────────────────────────

const securityReviewTool = defineTool({
  name: 'security_review',
  description: 'Review a code snippet for security vulnerabilities: SQL injection, XSS, insecure deserialization, hardcoded secrets, improper auth, etc.',
  schema: (s) => ({
    file: s.string().description('File path being reviewed').required(),
    code: s.string().description('The code to review').required(),
  }),
  handle: async (input) => {
    const r = await agent({
      provider: anthropic('claude-opus-4-6'),
      instructions: `You are a senior application security engineer.
Focus only on security issues — OWASP Top 10, secrets, auth flaws, injection vulnerabilities.
Be specific: reference the exact line and explain the exploit vector.
Do not comment on style or performance.`,
      schema: (s) => ({
        issues: s.array().items(s.string().toSchema())
          .description('List of security issues found. Empty array if none.').required(),
        hasCritical: s.boolean().description('true if any issue could be directly exploited').required(),
      }),
    }).prompt<{ issues: string[]; hasCritical: boolean }>(
      `Review for security issues:\nFile: ${input.file}\n\n\`\`\`\n${input.code}\n\`\`\``
    );

    r.structured.issues.forEach((issue) => {
      comments.push({
        severity: r.structured.hasCritical ? 'critical' : 'warning',
        file: String(input.file),
        title: 'Security issue',
        description: issue,
      });
    });

    return r.structured.issues.length > 0
      ? `Found ${r.structured.issues.length} security issue(s)${r.structured.hasCritical ? ' (CRITICAL)' : ''}.`
      : 'No security issues found.';
  },
});

const performanceReviewTool = defineTool({
  name: 'performance_review',
  description: 'Review code for performance issues: N+1 queries, missing indexes, blocking operations in async code, memory leaks, inefficient algorithms.',
  schema: (s) => ({
    file: s.string().required(),
    code: s.string().required(),
    context: s.string().description('What this code does').required(),
  }),
  handle: async (input) => {
    const r = await agent({
      provider: anthropic('claude-opus-4-6'),
      instructions: `You are a performance engineer specialising in Node.js and database optimisation.
Flag only genuine performance risks — not micro-optimisations.
Each issue should include: what's slow, why it matters at scale, and how to fix it.`,
      schema: (s) => ({
        issues: s.array().items(s.string().toSchema()).required(),
      }),
    }).prompt<{ issues: string[] }>(
      `Review for performance:\nFile: ${input.file}\nContext: ${input.context}\n\n\`\`\`\n${input.code}\n\`\`\``
    );

    r.structured.issues.forEach((issue) => {
      comments.push({ severity: 'warning', file: String(input.file), title: 'Performance issue', description: issue });
    });

    return r.structured.issues.length > 0
      ? `Found ${r.structured.issues.length} performance concern(s).`
      : 'No performance issues found.';
  },
});

const styleReviewTool = defineTool({
  name: 'style_review',
  description: 'Review code for readability and maintainability issues: naming, complexity, missing error handling, unclear logic.',
  schema: (s) => ({
    file: s.string().required(),
    code: s.string().required(),
  }),
  handle: async (input) => {
    const r = await agent({
      provider: anthropic('claude-haiku-4-5'),
      instructions: `You are a senior TypeScript engineer doing a code review.
Focus on readability and long-term maintainability — not personal style preferences.
Only flag issues that would confuse a new team member or cause future bugs.`,
      schema: (s) => ({
        suggestions: s.array().items(s.string().toSchema()).required(),
      }),
    }).prompt<{ suggestions: string[] }>(
      `Review for style and maintainability:\nFile: ${input.file}\n\n\`\`\`\n${input.code}\n\`\`\``
    );

    r.structured.suggestions.forEach((suggestion) => {
      comments.push({ severity: 'suggestion', file: String(input.file), title: 'Code quality', description: suggestion });
    });

    return r.structured.suggestions.length > 0
      ? `${r.structured.suggestions.length} style suggestion(s).`
      : 'Looks clean.';
  },
});

const suggestTestsTool = defineTool({
  name: 'suggest_tests',
  description: 'Suggest what tests should be added or updated for changed code.',
  schema: (s) => ({
    file: s.string().required(),
    code: s.string().required(),
  }),
  handle: async (input) => {
    const r = await agent({
      provider: anthropic('claude-haiku-4-5'),
      instructions: 'You are a test engineer. Suggest specific, valuable test cases — not generic boilerplate.',
      schema: (s) => ({
        testCases: s.array().items(s.string().toSchema())
          .description('Specific test case descriptions worth adding').required(),
      }),
    }).prompt<{ testCases: string[] }>(
      `What tests should cover this code?\nFile: ${input.file}\n\n\`\`\`\n${input.code}\n\`\`\``
    );

    r.structured.testCases.forEach((tc) => {
      comments.push({ severity: 'suggestion', file: String(input.file), title: 'Missing test', description: tc });
    });

    return `${r.structured.testCases.length} test case(s) suggested.`;
  },
});

const writeSummaryTool = defineTool({
  name: 'write_summary',
  description: 'Write the final review summary after all individual reviews are complete. Call this last.',
  schema: (s) => ({
    reviewFindings: s.string().description('Summary of all findings from the other tools').required(),
  }),
  handle: async (input) => {
    const criticals = comments.filter((c) => c.severity === 'critical').length;
    const warnings = comments.filter((c) => c.severity === 'warning').length;
    const suggestions = comments.filter((c) => c.severity === 'suggestion').length;

    const r = await agent({
      provider: anthropic('claude-opus-4-6'),
      instructions: 'You write concise, professional pull request review summaries.',
      schema: (s) => ({
        approved: s.boolean().description('true only if there are no critical issues').required(),
        summary: s.string().description('2–3 sentence overview of the review').required(),
      }),
    }).prompt<{ approved: boolean; summary: string }>(
      `Write a PR review summary.\nCritical: ${criticals}, Warnings: ${warnings}, Suggestions: ${suggestions}\n\nFindings:\n${input.reviewFindings}`
    );

    return JSON.stringify({
      approved: r.structured.approved,
      blockers: criticals,
      warnings,
      suggestions,
      summary: r.structured.summary,
    });
  },
});

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function reviewPullRequest(diff: string): Promise<{ summary: ReviewSummary; comments: ReviewComment[] }> {
  const result = await agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are a senior engineering manager conducting a pull request review.
Given a diff, decide which reviews are necessary for each changed file:
- Always run security_review on files touching auth, payments, data access, or user input
- Run performance_review on files with database queries, loops over large datasets, or API handlers
- Run style_review on all changed files
- Run suggest_tests on files with new functions or changed logic
- Call write_summary last with a combined description of all findings
Be thorough but avoid redundant reviews on trivial changes.`,
    tools: [securityReviewTool, performanceReviewTool, styleReviewTool, suggestTestsTool, writeSummaryTool],
    maxIterations: 30,
  }).prompt(`Review this pull request diff:\n\n${diff}`);

  let summary: ReviewSummary;
  try {
    summary = JSON.parse(result.text) as ReviewSummary;
  } catch {
    summary = { approved: false, blockers: 0, warnings: 0, suggestions: 0, summary: result.text };
  }

  return { summary, comments };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

const diff = `
diff --git a/src/auth/login.ts b/src/auth/login.ts
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -12,8 +12,15 @@ export async function login(req: Request, res: Response) {
-  const user = await db.query(\`SELECT * FROM users WHERE email = '\${req.body.email}'\`);
+  const user = await db.query(
+    'SELECT * FROM users WHERE email = $1',
+    [req.body.email]
+  );
   if (!user) return res.status(401).json({ error: 'Invalid credentials' });
-  const token = jwt.sign({ id: user.id }, 'hardcoded-secret-123');
+  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET!);
   res.json({ token });
`;

const review = await reviewPullRequest(diff);

console.log('\n══ PR Review ══════════════════════════════════');
console.log(`Status:      ${review.summary.approved ? '✓ APPROVED' : '✗ CHANGES REQUESTED'}`);
console.log(`Blockers:    ${review.summary.blockers}`);
console.log(`Warnings:    ${review.summary.warnings}`);
console.log(`Suggestions: ${review.summary.suggestions}`);
console.log(`\n${review.summary.summary}`);

if (review.comments.length > 0) {
  console.log('\n── Comments ───────────────────────────────────');
  review.comments.forEach((c) => {
    const icon = { critical: '🔴', warning: '🟡', suggestion: '💡' }[c.severity];
    console.log(`\n${icon} [${c.file}] ${c.title}`);
    console.log(`   ${c.description}`);
  });
}
```

## Why this structure works

- **Dynamic planning.** The orchestrator reads the diff and decides which reviews are needed. A diff touching only markdown doesn't trigger a security review.
- **Shared result collector.** Each tool appends to a shared `comments` array — the orchestrator doesn't need to parse tool results to assemble the final output.
- **Tiered model usage.** Security and performance reviews use `claude-opus-4-6`; style and test suggestions use the faster, cheaper `claude-haiku-4-5`.
- **Explicit last-step tool.** `write_summary` is called last by design — the instructions tell the orchestrator this, and its description reinforces it.
