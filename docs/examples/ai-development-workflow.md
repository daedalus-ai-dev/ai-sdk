# Example: AI-Driven Development Workflow

**Patterns used:** [Prompt Chaining](../patterns/prompt-chaining) · [Orchestrator-Workers](../patterns/orchestrator-workers) · [Evaluator-Optimizer](../patterns/evaluator-optimizer)

A full development lifecycle driven by AI agents — from a raw feature request to clean, reviewed, passing code. Humans are involved only when the agents can't resolve something themselves.

```
Feature Request
      │
      ▼
 Product Manager ──── unclear? ──► [wait for user input]
      │
      ▼
 Three Amigos Meeting ─── open question? ──► Specialist answers ──► unresolved? ──► [wait for user input]
      │
      ▼
 Test Automation (writes .feature file — tests fail by design)
      │
      ▼
 Coding Machine (breaks feature into tasks: open → in_progress → done)
      │
      ▼
 Developer ◄──────────── loop: one task at a time ───────────────────┐
      │                                                               │
      ▼                                                               │
 Test Runner ──── tests fail? ──► Coding Machine (new tasks) ────────┘
      │
      tests pass
      │
      ▼
 Code Reviewer (flags complexity, design violations)
      │
      ▼
 Refactorer (applies reviewer suggestions)
      │
      ▼
  Done ✓
```

## Shared state

All agents read and write a single shared `WorkflowState` object — the single source of truth for the session.

```ts
import * as fs from 'fs';
import * as readline from 'readline';
import { agent, defineTool, promptTemplate } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';

// ─── Shared state ─────────────────────────────────────────────────────────────

type TaskStatus = 'open' | 'in_progress' | 'done';

type Task = {
  id: string;
  title: string;
  description: string;
  filePath: string;
  status: TaskStatus;
  implementation?: string;
};

type WorkflowState = {
  featureRequest: string;
  userStory: string;
  acceptanceCriteria: string[];
  featureFile: string;       // Gherkin .feature content
  tasks: Task[];
  implementations: Record<string, string>;  // taskId → code
  reviewComments: string[];
  refactoredCode: Record<string, string>;   // filePath → cleaned code
};

const state: WorkflowState = {
  featureRequest: '',
  userStory: '',
  acceptanceCriteria: [],
  featureFile: '',
  tasks: [],
  implementations: {},
  reviewComments: [],
  refactoredCode: {},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const provider = anthropic('claude-opus-4-6');
const cheapProvider = anthropic('claude-haiku-4-5');

async function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n❓ ${question}\n> `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function log(phase: string, message: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${phase}] ${message}`);
  console.log('─'.repeat(60));
}
```

## Step 1 — Product Manager: write the user story

The PM agent turns the raw feature request into a structured user story with acceptance criteria. If requirements are ambiguous, it returns a list of clarifying questions instead of guessing.

```ts
// ─── Step 1: Product Manager ──────────────────────────────────────────────────

async function writeUserStory(featureRequest: string): Promise<void> {
  log('PM', `Processing: "${featureRequest}"`);

  type PMOutput = {
    ready: boolean;
    userStory: string;
    acceptanceCriteria: string[];
    clarifyingQuestions: string[];
  };

  const result = await agent({
    provider,
    instructions: `You are a senior product manager.
Given a feature request, write a crisp user story and acceptance criteria.
If the request is too vague to write testable criteria, set ready=false and list clarifying questions.
User story format: "As a [persona], I want [goal], so that [benefit]."
Acceptance criteria: specific, testable, BDD-style "Given/When/Then" statements.`,
    schema: (s) => ({
      ready: s.boolean().description('false if clarifying questions are needed').required(),
      userStory: s.string().description('The user story, or empty string if not ready').required(),
      acceptanceCriteria: s.array().items(s.string().toSchema())
        .description('Testable acceptance criteria').required(),
      clarifyingQuestions: s.array().items(s.string().toSchema())
        .description('Questions to ask the requester. Empty if ready=true').required(),
    }),
  }).prompt<PMOutput>(`Feature request: "${featureRequest}"`);

  if (!result.structured.ready) {
    console.log('\n📋 Requirements are unclear. Need answers to:');
    result.structured.clarifyingQuestions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

    const answers: string[] = [];
    for (const question of result.structured.clarifyingQuestions) {
      const answer = await askUser(question);
      answers.push(`Q: ${question}\nA: ${answer}`);
    }

    // Re-run with the answers
    const enrichedRequest = `${featureRequest}\n\nClarifications:\n${answers.join('\n\n')}`;
    return writeUserStory(enrichedRequest);
  }

  state.userStory = result.structured.userStory;
  state.acceptanceCriteria = result.structured.acceptanceCriteria;

  console.log(`\n✓ User Story: ${state.userStory}`);
  console.log('\n✓ Acceptance Criteria:');
  state.acceptanceCriteria.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
}
```

## Step 2 — Three Amigos: BDD refinement meeting

The three amigos (Business Analyst, Developer, Tester) each examine the user story from their perspective and surface questions. Specialist agents answer what they can; unresolvable questions escalate to the user.

```ts
// ─── Step 2: Three Amigos ─────────────────────────────────────────────────────

type Amigo = { role: string; perspective: string };

const amigos: Amigo[] = [
  {
    role: 'Business Analyst',
    perspective: `Focus on business rules, edge cases, and user personas.
Ask about: exceptional flows, business constraints, regulatory requirements, priority.`,
  },
  {
    role: 'Developer',
    perspective: `Focus on technical feasibility, system integration, and implementation risks.
Ask about: data models, APIs, performance requirements, dependencies, breaking changes.`,
  },
  {
    role: 'Tester',
    perspective: `Focus on testability, negative paths, and quality concerns.
Ask about: error scenarios, boundary values, data validation, non-functional requirements.`,
  },
];

type AmigoQuestion = { question: string; canBeAnswered: boolean; answer: string };

async function conductThreeAmigosMeeting(): Promise<void> {
  log('THREE AMIGOS', 'Starting BDD refinement meeting');

  const storyContext = `
User Story: ${state.userStory}

Acceptance Criteria:
${state.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
  `.trim();

  // Each amigo surfaces their questions
  const allQuestions: Array<{ role: string } & AmigoQuestion> = [];

  for (const amigo of amigos) {
    console.log(`\n🎭 ${amigo.role} is reviewing...`);

    const r = await agent({
      provider: cheapProvider,
      instructions: `You are a ${amigo.role} in a Three Amigos BDD meeting.
${amigo.perspective}
For each question you raise, also try to answer it from your expertise.
If you cannot answer it confidently, mark it as unresolvable — it needs the product owner.`,
      schema: (s) => ({
        questions: s.array().items(s.string().toSchema())
          .description('Questions this role raises about the story').required(),
        answers: s.array().items(s.string().toSchema())
          .description('Best-effort answer for each question, or "NEEDS_PO" if unresolvable').required(),
      }),
    }).prompt<{ questions: string[]; answers: string[] }>(storyContext);

    r.structured.questions.forEach((q, i) => {
      const rawAnswer = r.structured.answers[i] ?? 'NEEDS_PO';
      allQuestions.push({
        role: amigo.role,
        question: q,
        canBeAnswered: rawAnswer !== 'NEEDS_PO',
        answer: rawAnswer,
      });
    });
  }

  // Cross-amigo answers: let each amigo answer other roles' questions
  const unresolved = allQuestions.filter((q) => !q.canBeAnswered);

  for (const item of unresolved) {
    console.log(`\n❓ [${item.role}] ${item.question}`);

    // Ask the other two amigos
    const otherAmigos = amigos.filter((a) => a.role !== item.role);
    let resolved = false;

    for (const amigo of otherAmigos) {
      const r = await agent({
        provider: cheapProvider,
        instructions: `You are a ${amigo.role}. Answer this BDD meeting question if you can from your expertise.
If you cannot answer it, respond with exactly: NEEDS_PO`,
      }).prompt(`Question: "${item.question}"\n\nStory context:\n${storyContext}`);

      if (!r.text.includes('NEEDS_PO')) {
        console.log(`  ✓ Answered by ${amigo.role}: ${r.text}`);
        item.answer = r.text;
        item.canBeAnswered = true;
        resolved = true;
        break;
      }
    }

    // No specialist could answer — escalate to user
    if (!resolved) {
      console.log(`  ⚠ No specialist could answer this — asking product owner.`);
      const answer = await askUser(`[${item.role}]: ${item.question}`);
      item.answer = answer;
      item.canBeAnswered = true;
    }
  }

  // Print the meeting summary
  console.log('\n\n📋 Three Amigos Meeting Summary:');
  allQuestions.forEach((q) => {
    console.log(`\n  [${q.role}] Q: ${q.question}`);
    console.log(`           A: ${q.answer}`);
  });

  // Enrich acceptance criteria with meeting outcomes
  const meetingNotes = allQuestions.map((q) => `[${q.role}] ${q.question} → ${q.answer}`).join('\n');

  const enriched = await agent({
    provider,
    instructions: 'You refine BDD acceptance criteria based on meeting notes. Keep existing criteria; add new ones discovered in the meeting. Return all criteria including originals.',
    schema: (s) => ({
      acceptanceCriteria: s.array().items(s.string().toSchema()).required(),
    }),
  }).prompt<{ acceptanceCriteria: string[] }>(
    `Original criteria:\n${state.acceptanceCriteria.join('\n')}\n\nMeeting notes:\n${meetingNotes}`
  );

  state.acceptanceCriteria = enriched.structured.acceptanceCriteria;
  console.log(`\n✓ Acceptance criteria enriched to ${state.acceptanceCriteria.length} items.`);
}
```

## Step 3 — Test Automation: write the failing .feature file

Writes executable Gherkin scenarios from the acceptance criteria. The tests are meant to fail — the implementation doesn't exist yet.

```ts
// ─── Step 3: Test Automation ──────────────────────────────────────────────────

async function writeFeatureFile(outputPath: string): Promise<void> {
  log('TEST AUTOMATION', 'Writing .feature file');

  const r = await agent({
    provider,
    instructions: `You are a test automation engineer writing Cucumber/Gherkin .feature files.
Rules:
- Each acceptance criterion becomes one or more Scenario or Scenario Outline
- Use concrete, realistic test data (not "foo", "bar", or "123")
- Include at least one negative path (invalid input, unauthorised access, etc.)
- Step definitions should read like natural English — avoid jargon
- The file should be executable but the tests will FAIL until implementation is complete`,
  }).prompt(
    `Write a complete .feature file for:\n\nUser Story: ${state.userStory}\n\nAcceptance Criteria:\n${state.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
  );

  state.featureFile = r.text;
  fs.writeFileSync(outputPath, r.text, 'utf8');

  console.log(`\n✓ Feature file written to: ${outputPath}`);
  console.log('\n' + r.text);
}
```

## Step 4 — Coding Machine: plan the implementation tasks

The coding machine analyses the feature file and user story, then creates a prioritised task list — each task maps to a specific file or module to create or modify.

```ts
// ─── Step 4: Coding Machine ───────────────────────────────────────────────────

async function planImplementationTasks(): Promise<void> {
  log('CODING MACHINE', 'Planning implementation tasks');

  const r = await agent({
    provider,
    instructions: `You are a senior engineer planning the implementation of a feature.
Break the feature into focused, independently implementable tasks.
Each task should map to a single file or well-scoped module change.
Order tasks by dependency: foundational code first, integration last.
Each task must have a clear "done" definition.`,
    schema: (s) => ({
      tasks: s.array().items(s.string().toSchema())
        .description('JSON strings, each a {id, title, description, filePath} object').required(),
    }),
  }).prompt<{ tasks: string[] }>(
    `Feature:\n${state.userStory}\n\nAcceptance Criteria:\n${state.acceptanceCriteria.join('\n')}\n\nFeature File:\n${state.featureFile}`
  );

  state.tasks = r.structured.tasks.map((raw, i) => {
    try {
      const parsed = JSON.parse(raw) as Omit<Task, 'status'>;
      return { ...parsed, status: 'open' as TaskStatus };
    } catch {
      return {
        id: `task-${i + 1}`,
        title: raw.slice(0, 60),
        description: raw,
        filePath: `src/feature-${i + 1}.ts`,
        status: 'open' as TaskStatus,
      };
    }
  });

  console.log(`\n✓ ${state.tasks.length} tasks planned:`);
  state.tasks.forEach((t) => {
    console.log(`  [ ] ${t.id}: ${t.title}`);
    console.log(`      ${t.filePath}`);
  });
}
```

## Step 5 — Developer: implement tasks in a loop

The developer agent implements one task at a time, writing real TypeScript. It reads the task description, the feature file for context, and any already-implemented code to stay consistent.

```ts
// ─── Step 5: Developer (task loop) ───────────────────────────────────────────

const implementTaskTool = defineTool({
  name: 'write_implementation',
  description: 'Write the implementation for a task and mark it done.',
  schema: (s) => ({
    taskId: s.string().description('ID of the task being implemented').required(),
    code: s.string().description('Complete TypeScript implementation for this task').required(),
    notes: s.string().description('Brief note on implementation decisions').required(),
  }),
  handle: async (input) => {
    const task = state.tasks.find((t) => t.id === String(input.taskId));
    if (!task) return `Task ${input.taskId} not found.`;

    task.status = 'done';
    task.implementation = String(input.code);
    state.implementations[task.id] = String(input.code);

    fs.mkdirSync(require('path').dirname(task.filePath), { recursive: true });
    fs.writeFileSync(task.filePath, String(input.code), 'utf8');

    console.log(`  ✓ Task done: ${task.title}`);
    console.log(`    Note: ${input.notes}`);
    return `Task ${task.id} marked done. File written to ${task.filePath}.`;
  },
});

const getNextTaskTool = defineTool({
  name: 'get_next_task',
  description: 'Get the next open task to implement.',
  schema: (s) => ({
    dummy: s.string().description('Pass empty string').required(),
  }),
  handle: async () => {
    const next = state.tasks.find((t) => t.status === 'open');
    if (!next) return 'No more open tasks.';
    next.status = 'in_progress';
    return JSON.stringify(next);
  },
});

const getImplementedCodeTool = defineTool({
  name: 'get_implemented_code',
  description: 'Get all already-implemented code for context.',
  schema: (s) => ({
    dummy: s.string().description('Pass empty string').required(),
  }),
  handle: async () => {
    const done = state.tasks.filter((t) => t.status === 'done');
    if (done.length === 0) return 'No code implemented yet.';
    return done.map((t) => `// ${t.filePath}\n${t.implementation}`).join('\n\n');
  },
});

async function runDeveloperLoop(): Promise<void> {
  log('DEVELOPER', 'Starting implementation loop');

  const openTasks = state.tasks.filter((t) => t.status === 'open');
  console.log(`\n${openTasks.length} tasks to implement.`);

  const context = `
User Story: ${state.userStory}

Feature File:
${state.featureFile}

Tasks to implement:
${state.tasks.map((t) => `[${t.status}] ${t.id}: ${t.title} → ${t.filePath}`).join('\n')}
  `.trim();

  await agent({
    provider,
    instructions: `You are a senior TypeScript developer implementing a feature task by task.
Use get_next_task to pick the next open task.
Use get_implemented_code to see what's already been written.
Use write_implementation to write the code and mark the task done.
Write clean, idiomatic TypeScript with proper error handling.
Continue until get_next_task reports no more tasks.`,
    tools: [getNextTaskTool, getImplementedCodeTool, implementTaskTool],
    maxIterations: state.tasks.length * 4,
  }).prompt(context);

  const done = state.tasks.filter((t) => t.status === 'done').length;
  console.log(`\n✓ Implementation complete: ${done}/${state.tasks.length} tasks done.`);
}
```

## Step 6 — Test Runner: check if tests pass

Runs the test suite. If tests fail, control returns to the Coding Machine which plans additional fix tasks. This loop repeats until all tests pass.

```ts
// ─── Step 6: Test Runner ──────────────────────────────────────────────────────

import { execSync } from 'child_process';

type TestResult = { passed: boolean; output: string; failingSummary: string };

function runTests(featureFilePath: string): TestResult {
  try {
    const output = execSync(`npx cucumber-js ${featureFilePath} --format summary`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output, failingSummary: '' };
  } catch (err: unknown) {
    const output = (err as { stdout?: string; stderr?: string }).stdout
      ?? (err as { message?: string }).message
      ?? 'Unknown error';
    return { passed: false, output, failingSummary: output.slice(0, 2000) };
  }
}

async function planFixTasks(testOutput: string): Promise<void> {
  log('CODING MACHINE', 'Planning fix tasks based on test failures');

  const r = await agent({
    provider,
    instructions: `You are a senior engineer triaging failing BDD tests.
Analyse the test failures and create specific fix tasks.
Each fix task must reference the exact failing step and the file to modify.`,
    schema: (s) => ({
      tasks: s.array().items(s.string().toSchema())
        .description('JSON strings, each a {id, title, description, filePath} object').required(),
    }),
  }).prompt<{ tasks: string[] }>(
    `Tests are failing. Plan fix tasks.\n\nTest output:\n${testOutput}\n\nImplemented files:\n${state.tasks.filter((t) => t.status === 'done').map((t) => t.filePath).join('\n')}`
  );

  const fixTasks = r.structured.tasks.map((raw, i) => {
    try {
      const parsed = JSON.parse(raw) as Omit<Task, 'status'>;
      return { ...parsed, status: 'open' as TaskStatus };
    } catch {
      return {
        id: `fix-${Date.now()}-${i}`,
        title: raw.slice(0, 60),
        description: raw,
        filePath: 'src/fix.ts',
        status: 'open' as TaskStatus,
      };
    }
  });

  state.tasks.push(...fixTasks);
  console.log(`\n✓ ${fixTasks.length} fix tasks added.`);
}

async function testAndFixLoop(featureFilePath: string, maxAttempts = 3): Promise<void> {
  log('TEST RUNNER', 'Running tests');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = runTests(featureFilePath);

    if (result.passed) {
      console.log('\n✅ All tests pass!');
      return;
    }

    console.log(`\n❌ Tests failed (attempt ${attempt}/${maxAttempts})`);
    console.log(result.failingSummary);

    if (attempt === maxAttempts) {
      console.log('\n⚠ Max fix attempts reached. Manual intervention needed.');
      return;
    }

    await planFixTasks(result.failingSummary);
    await runDeveloperLoop();
  }
}
```

## Step 7 — Code Reviewer: surface design concerns

The reviewer checks the implemented code against design principles (SOLID, DRY, separation of concerns) and flags anything that's too complex or should be refactored.

```ts
// ─── Step 7: Code Reviewer ────────────────────────────────────────────────────

async function reviewCode(): Promise<void> {
  log('CODE REVIEWER', 'Reviewing implementation');

  const codebase = state.tasks
    .filter((t) => t.status === 'done' && t.implementation)
    .map((t) => `// ── ${t.filePath} ──\n${t.implementation}`)
    .join('\n\n');

  const r = await agent({
    provider,
    instructions: `You are a principal engineer doing a thorough code review.
Review against:
- SOLID principles (especially Single Responsibility and Open/Closed)
- DRY — flag duplication that should be extracted
- Separation of concerns — business logic, I/O, and framework code should be separate
- Complexity — functions longer than 20 lines or cyclomatic complexity > 3 deserve scrutiny
- Naming — if a name doesn't reveal intent, flag it

For each issue, state:
1. What the problem is
2. Why it matters
3. A specific refactoring suggestion

Only flag real issues — not personal preferences.`,
    schema: (s) => ({
      comments: s.array().items(s.string().toSchema())
        .description('Review comments. Empty array if the code is clean.').required(),
      requiresRefactoring: s.boolean().required(),
    }),
  }).prompt<{ comments: string[]; requiresRefactoring: boolean }>(
    `Review this implementation:\n\n${codebase}`
  );

  state.reviewComments = r.structured.comments;

  if (!r.structured.requiresRefactoring) {
    console.log('\n✓ Code review passed — no refactoring needed.');
    return;
  }

  console.log(`\n📝 ${r.structured.comments.length} review comment(s):`);
  r.structured.comments.forEach((c, i) => console.log(`\n  ${i + 1}. ${c}`));
}
```

## Step 8 — Refactorer: clean up the code

Applies the reviewer's suggestions to each file, producing clean final implementations.

```ts
// ─── Step 8: Refactorer ───────────────────────────────────────────────────────

async function refactorCode(): Promise<void> {
  if (state.reviewComments.length === 0) return;

  log('REFACTORER', 'Applying review suggestions');

  const reviewFeedback = state.reviewComments
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');

  const doneTasks = state.tasks.filter((t) => t.status === 'done' && t.implementation);

  for (const task of doneTasks) {
    console.log(`\n  Refactoring: ${task.filePath}`);

    const r = await agent({
      provider,
      instructions: `You are a principal engineer refactoring code based on review feedback.
Apply every relevant suggestion from the review.
Do NOT change behaviour — only structure, naming, and organisation.
Preserve all existing function signatures that are used externally.
Return only the refactored code, no explanation.`,
    }).prompt(
      `Refactor this file based on the review feedback.\n\nFile: ${task.filePath}\n\nCode:\n${task.implementation}\n\nReview feedback:\n${reviewFeedback}`
    );

    state.refactoredCode[task.filePath] = r.text;
    fs.writeFileSync(task.filePath, r.text, 'utf8');
    console.log(`  ✓ ${task.filePath} refactored`);
  }
}
```

## Orchestrating the full workflow

```ts
// ─── Main orchestrator ────────────────────────────────────────────────────────

async function runDevelopmentWorkflow(featureRequest: string): Promise<void> {
  const featureFilePath = 'features/new-feature.feature';
  state.featureRequest = featureRequest;

  console.log('\n🚀 Starting AI-driven development workflow');
  console.log(`   Feature: "${featureRequest}"\n`);

  // 1 — Clarify requirements and write user story
  await writeUserStory(featureRequest);

  // 2 — Three Amigos BDD meeting
  await conductThreeAmigosMeeting();

  // 3 — Write the failing .feature file
  await writeFeatureFile(featureFilePath);

  // 4 — Plan implementation tasks
  await planImplementationTasks();

  // 5 — Developer loop: implement all tasks
  await runDeveloperLoop();

  // 6 — Test runner + fix loop
  await testAndFixLoop(featureFilePath);

  // 7 — Code review
  await reviewCode();

  // 8 — Refactor if needed
  await refactorCode();

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n✅ Workflow complete!');
  console.log(`\nUser Story:     ${state.userStory}`);
  console.log(`Tasks:          ${state.tasks.length} (${state.tasks.filter((t) => t.status === 'done').length} done)`);
  console.log(`Feature file:   ${featureFilePath}`);
  console.log(`Files written:  ${Object.keys(state.refactoredCode).length > 0
    ? Object.keys(state.refactoredCode).join(', ')
    : state.tasks.filter((t) => t.status === 'done').map((t) => t.filePath).join(', ')}`);
  console.log(`Review notes:   ${state.reviewComments.length}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

await runDevelopmentWorkflow(
  'Users should be able to reset their password via email'
);
```

## Why this structure works

### Human-in-the-loop only when necessary

The agents answer each other's questions first. The system escalates to a human only when no specialist can resolve an open question. A well-specified feature request may complete with zero human interruptions.

### Shared mutable state as a blackboard

All agents read and write `WorkflowState`. This is the "blackboard" pattern — tools don't need to pass data to each other explicitly. The test runner sees what the developer wrote; the refactorer sees what the reviewer flagged.

### Tests fail by design

Writing the `.feature` file before the implementation is deliberate — it enforces the TDD red→green→refactor cycle. The test runner loop closes the feedback loop automatically.

### Tiered models per agent

| Agent | Model | Why |
|---|---|---|
| PM, Three Amigos | `claude-haiku-4-5` | Classification and question-generation; fast and cheap |
| Test Automation | `claude-opus-4-6` | Gherkin quality matters — saves debugging time later |
| Coding Machine | `claude-opus-4-6` | Task planning shapes the entire implementation |
| Developer | `claude-opus-4-6` | Code quality is critical |
| Test Runner | n/a | Deterministic shell command |
| Code Reviewer | `claude-opus-4-6` | Nuanced design judgement |
| Refactorer | `claude-opus-4-6` | Structural code changes require full understanding |

### Task state as a control loop

The `open → in_progress → done` state machine gives the developer agent a clear queue to work from and lets the orchestrator know when implementation is complete without parsing free-form text.

## Extending this example

**Persist state between sessions** (for long-running features):

```ts
fs.writeFileSync('.workflow-state.json', JSON.stringify(state, null, 2));
// Resume: const state = JSON.parse(fs.readFileSync('.workflow-state.json', 'utf8'));
```

**Add a PR description agent** as a final step:

```ts
const pr = await agent({ provider, instructions: 'Write a GitHub PR description.' })
  .prompt(`User story: ${state.userStory}\n\nTasks: ${state.tasks.map((t) => t.title).join(', ')}`);
console.log('\nPR Description:\n', pr.text);
```

**Parallelise the Three Amigos** (all three review simultaneously):

```ts
const [baQuestions, devQuestions, testQuestions] = await Promise.all(
  amigos.map((amigo) => runAmigo(amigo, storyContext))
);
```
