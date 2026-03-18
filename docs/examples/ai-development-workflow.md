# Example: AI-Driven Development Workflow

**Patterns used:** [Prompt Chaining](../patterns/prompt-chaining) · [Orchestrator-Workers](../patterns/orchestrator-workers) · [Evaluator-Optimizer](../patterns/evaluator-optimizer)

**SDK features:** `defineTool` · `Agent Registry` · `promptTemplate` · `slidingWindow` / `summarizing` · `connectMcp`

A full development lifecycle driven by AI agents — from a raw feature request to clean, reviewed, passing code. Agents handle every step autonomously and escalate to a human only when they genuinely can't resolve something themselves.

```
Feature Request
      │
      ▼
 Product Manager ──── unclear? ──► [wait for user input]
      │
      ▼
 Three Amigos Meeting ── open question? ──► Specialist answers ──► unresolved? ──► [wait for user input]
      │
      ▼
 Test Automation  (writes .feature — tests fail by design)
      │
      ▼
 Coding Machine  (breaks into tasks: open → in_progress → done)
      │
      ▼
 Developer ◄──────── loop: one task at a time ────────────────┐
      │                                                        │
      ▼                                                        │
 Test Runner ──── fail? ──► Coding Machine (fix tasks) ───────┘
      │
  tests pass
      │
      ▼
 Code Reviewer  (SOLID · DRY · complexity)
      │
      ▼
 Refactorer  (applies review suggestions via MCP filesystem)
      │
      ▼
   Done ✓
```

## Project structure

```
ai-dev-workflow/
├── package.json
├── tsconfig.json
├── features/                          # Generated Gherkin files (git-committed)
│   └── password-reset.feature
├── step-definitions/                  # Cucumber step definitions (generated)
│   └── password-reset.steps.ts
└── src/
    ├── index.ts                       # Entry point — orchestrates the full workflow
    ├── state.ts                       # Shared WorkflowState (blackboard)
    ├── prompts.ts                     # promptTemplate definitions (multilingual)
    ├── mcp.ts                         # connectMcp() — filesystem + GitHub MCP servers
    ├── registry.ts                    # registerAgent() — all agents in one place
    └── tools/
        ├── task-tools.ts              # defineTool() — task queue management
        └── input-tools.ts             # defineTool() — stdin prompting
```

**`package.json`**

```json
{
  "name": "ai-dev-workflow",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test:features": "cucumber-js features/**/*.feature"
  },
  "dependencies": {
    "@daedalus-ai-dev/ai-sdk": "^0.1.4",
    "@cucumber/cucumber": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## `src/state.ts` — Shared blackboard

All agents read and write this object. No agent needs to pass data to another explicitly.

```ts
// src/state.ts

export type TaskStatus = 'open' | 'in_progress' | 'done';

export type Task = {
  id: string;
  title: string;
  description: string;
  filePath: string;
  status: TaskStatus;
  implementation?: string;
};

export type WorkflowState = {
  featureRequest: string;
  language: string;                          // team language: 'en' | 'de' | 'fr' | 'es'
  userStory: string;
  acceptanceCriteria: string[];
  featureFile: string;
  tasks: Task[];
  implementations: Record<string, string>;   // taskId → code
  reviewComments: string[];
  refactoredCode: Record<string, string>;    // filePath → cleaned code
};

export const state: WorkflowState = {
  featureRequest: '',
  language: 'en',
  userStory: '',
  acceptanceCriteria: [],
  featureFile: '',
  tasks: [],
  implementations: {},
  reviewComments: [],
  refactoredCode: {},
};

export function log(phase: string, message: string): void {
  console.log(`\n${'─'.repeat(60)}\n[${phase}] ${message}\n${'─'.repeat(60)}`);
}
```

---

## `src/prompts.ts` — Prompt templates

All agent system prompts are defined here with `promptTemplate`. The `language` variable lets every agent communicate in the team's language — useful for multilingual organisations.

```ts
// src/prompts.ts
import { promptTemplate } from '@daedalus-ai-dev/ai-sdk';

// Injected into every agent prompt when language !== 'en'
const languageInstruction: Record<string, string> = {
  en: '',
  de: 'Respond in German (Deutsch). All output — user stories, criteria, code comments — in German.',
  fr: 'Respond in French (Français). All output in French.',
  es: 'Respond in Spanish (Español). All output in Spanish.',
};

export function lang(code: string): string {
  return languageInstruction[code] ?? '';
}

// ─── Product Manager ──────────────────────────────────────────────────────────

export const pmPrompt = promptTemplate`You are a senior product manager.
${'languageInstruction'}
Given a feature request, write a crisp user story and acceptance criteria.
If the request is too vague to write testable criteria, set ready=false and list clarifying questions.
User story format: "As a [persona], I want [goal], so that [benefit]."
Acceptance criteria: specific, testable, BDD-style "Given/When/Then" statements.`;

// ─── Three Amigos ─────────────────────────────────────────────────────────────

export const amigoPrompt = promptTemplate`You are a ${'role'} in a Three Amigos BDD meeting.
${'languageInstruction'}
${'perspective'}
For each question you raise, also try to answer it from your expertise.
If you cannot answer it confidently, mark the answer as "NEEDS_PO".`;

export const criteriaEnricherPrompt = promptTemplate`You refine BDD acceptance criteria based on meeting notes.
${'languageInstruction'}
Keep all existing criteria and add new ones discovered in the meeting.`;

// ─── Test Automation ──────────────────────────────────────────────────────────

export const testAutomationPrompt = promptTemplate`You are a test automation engineer writing Cucumber/Gherkin .feature files.
${'languageInstruction'}
Rules:
- Each acceptance criterion becomes one or more Scenario or Scenario Outline
- Use concrete, realistic test data (not "foo", "bar", or "123")
- Include at least one negative path per feature
- Step text should read like natural English — no jargon
- The file will be executable but FAIL until implementation is complete`;

// ─── Coding Machine ───────────────────────────────────────────────────────────

export const codingMachinePrompt = promptTemplate`You are a senior TypeScript engineer planning a feature implementation.
${'languageInstruction'}
Break the feature into focused, independently implementable tasks.
Each task maps to a single file or well-scoped module.
Order by dependency: foundational code first, integration last.
Each task must have a clear "done" definition.`;

export const fixPlannerPrompt = promptTemplate`You are a senior engineer triaging failing BDD tests.
${'languageInstruction'}
Analyse the failures and create specific fix tasks.
Each task must reference the exact failing step and the file to change.`;

// ─── Developer ────────────────────────────────────────────────────────────────

export const developerPrompt = promptTemplate`You are a senior TypeScript developer implementing a feature task by task.
${'languageInstruction'}
Use get_next_task to fetch the next open task.
Use get_implemented_code to see what already exists — stay consistent.
Use write_file to write the implementation to disk.
Use complete_task to mark a task done.
Write clean, idiomatic TypeScript with proper error handling.
Continue until get_next_task reports no more open tasks.`;

// ─── Code Reviewer ────────────────────────────────────────────────────────────

export const reviewerPrompt = promptTemplate`You are a principal engineer doing a thorough code review.
${'languageInstruction'}
Review against:
- SOLID principles (especially SRP and OCP)
- DRY — flag duplication that should be extracted
- Separation of concerns — business logic must not mix with I/O or framework code
- Complexity — functions > 20 lines or cyclomatic complexity > 3 deserve scrutiny
- Naming — names must reveal intent without a comment

For each issue: what the problem is, why it matters, specific refactoring suggestion.
Only flag real issues — not style preferences.`;

// ─── Refactorer ───────────────────────────────────────────────────────────────

export const refactorerPrompt = promptTemplate`You are a principal engineer refactoring code based on review feedback.
${'languageInstruction'}
Apply every relevant suggestion from the review.
Do NOT change behaviour — only structure, naming, and organisation.
Preserve all existing function signatures that are used externally.
Use read_file to read the current file and write_file to save the refactored version.`;
```

---

## `src/mcp.ts` — MCP connections

The developer and refactorer agents use the filesystem MCP server to read and write source files — no raw `fs` module calls scattered across the codebase.

```ts
// src/mcp.ts
import { connectMcp } from '@daedalus-ai-dev/ai-sdk';
import type { McpConnection } from '@daedalus-ai-dev/ai-sdk';
import * as path from 'path';

let _fs: McpConnection | null = null;

/**
 * Lazy singleton — connects on first use, reuses the connection afterwards.
 * The filesystem MCP server exposes read_file, write_file, list_directory, etc.
 */
export async function getFilesystemMcp(): Promise<McpConnection> {
  if (_fs) return _fs;

  _fs = await connectMcp({
    type: 'stdio',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      path.resolve(process.cwd()),   // allow access to the project root
    ],
  });

  console.log('✓ Filesystem MCP connected');
  return _fs;
}

/**
 * Optional: connect a GitHub MCP server for PR creation at the end
 * of the workflow. Requires GITHUB_TOKEN in the environment.
 */
export async function getGithubMcp(): Promise<McpConnection> {
  return connectMcp({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '' },
  });
}
```

---

## `src/tools/task-tools.ts` — Task queue tools

The developer agent uses these to atomically claim and complete tasks from the shared queue.

```ts
// src/tools/task-tools.ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import { state } from '../state.js';
import type { Task } from '../state.js';

/** Claim the next open task and mark it in_progress. */
export const getNextTaskTool = defineTool({
  name: 'get_next_task',
  description: 'Claim the next open task from the queue. Returns the task JSON or "NO_TASKS" if the queue is empty.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    const next = state.tasks.find((t) => t.status === 'open');
    if (!next) return 'NO_TASKS';
    next.status = 'in_progress';
    return JSON.stringify(next);
  },
});

/** Mark a task done and store its implementation in state. */
export const completeTaskTool = defineTool({
  name: 'complete_task',
  description: 'Mark a task as done. Call after write_file has saved the implementation.',
  schema: (s) => ({
    taskId: s.string().description('ID of the completed task').required(),
    notes: s.string().description('One-line note on key implementation decisions').required(),
  }),
  handle: async (input) => {
    const task = state.tasks.find((t) => t.id === String(input.taskId));
    if (!task) return `Task ${input.taskId} not found.`;
    task.status = 'done';
    console.log(`    ✓ [${task.id}] ${task.title}`);
    console.log(`      → ${input.notes}`);
    return `Task ${task.id} marked done.`;
  },
});

/** Return all completed code for context when starting a new task. */
export const getImplementedCodeTool = defineTool({
  name: 'get_implemented_code',
  description: 'Return all already-implemented files for context. Read this before starting a new task to stay consistent.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    const done = state.tasks.filter((t) => t.status === 'done' && t.implementation);
    if (done.length === 0) return 'Nothing implemented yet.';
    return done.map((t: Task) => `// ── ${t.filePath} ──\n${t.implementation}`).join('\n\n');
  },
});

/** Return the full task board for the coding machine to inspect. */
export const getTaskBoardTool = defineTool({
  name: 'get_task_board',
  description: 'Return the current task board with all tasks and their statuses.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    return state.tasks
      .map((t: Task) => `[${t.status.toUpperCase().padEnd(11)}] ${t.id}: ${t.title} → ${t.filePath}`)
      .join('\n');
  },
});
```

---

## `src/tools/input-tools.ts` — Human-in-the-loop tool

Agents call this when they need a human answer. It blocks until the user types a response.

```ts
// src/tools/input-tools.ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import * as readline from 'readline';

export const askUserTool = defineTool({
  name: 'ask_user',
  description: 'Ask the human a question and wait for their answer. Only use this when no agent can resolve the question.',
  schema: (s) => ({
    question: s.string().description('The question to ask').required(),
    context: s.string().description('Brief context for why this question is being asked').required(),
  }),
  handle: async (input) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<string>((resolve) => {
      console.log(`\n  Context: ${input.context}`);
      rl.question(`\n❓ ${input.question}\n> `, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  },
});
```

---

## `src/registry.ts` — Agent registry

All agents are registered at startup. The main orchestrator delegates via `agentTool()` — it never calls agent functions directly.

```ts
// src/registry.ts
import {
  registerAgent,
  agentTool,
  agent,
  slidingWindow,
  summarizing,
  tokenBudget,
} from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import {
  pmPrompt, amigoPrompt, criteriaEnricherPrompt, testAutomationPrompt,
  codingMachinePrompt, fixPlannerPrompt, developerPrompt,
  reviewerPrompt, refactorerPrompt, lang,
} from './prompts.js';
import {
  getNextTaskTool, completeTaskTool, getImplementedCodeTool, getTaskBoardTool,
} from './tools/task-tools.js';
import { askUserTool } from './tools/input-tools.js';
import { state } from './state.js';

const opus   = anthropic('claude-opus-4-6');
const haiku  = anthropic('claude-haiku-4-5');

export function setupRegistry(): void {

  // ── Product Manager ──────────────────────────────────────────────────────────
  registerAgent('product-manager', agent({
    provider: haiku,
    instructions: pmPrompt({ languageInstruction: lang(state.language) }),
    tools: [askUserTool],
    // PM conversations stay short — sliding window is enough
    contextManager: slidingWindow(10),
  }));

  // ── Three Amigos — Business Analyst ──────────────────────────────────────────
  registerAgent('amigo-ba', agent({
    provider: haiku,
    instructions: amigoPrompt({
      role: 'Business Analyst',
      languageInstruction: lang(state.language),
      perspective: 'Focus on business rules, edge cases, user personas, and regulatory constraints.',
    }),
    tools: [askUserTool],
    contextManager: tokenBudget(4000),
  }));

  // ── Three Amigos — Developer ─────────────────────────────────────────────────
  registerAgent('amigo-dev', agent({
    provider: haiku,
    instructions: amigoPrompt({
      role: 'Developer',
      languageInstruction: lang(state.language),
      perspective: 'Focus on technical feasibility, data models, APIs, dependencies, and breaking changes.',
    }),
    tools: [askUserTool],
    contextManager: tokenBudget(4000),
  }));

  // ── Three Amigos — Tester ────────────────────────────────────────────────────
  registerAgent('amigo-tester', agent({
    provider: haiku,
    instructions: amigoPrompt({
      role: 'Tester',
      languageInstruction: lang(state.language),
      perspective: 'Focus on error scenarios, boundary values, data validation, and non-functional requirements.',
    }),
    tools: [askUserTool],
    contextManager: tokenBudget(4000),
  }));

  // ── Criteria Enricher ────────────────────────────────────────────────────────
  registerAgent('criteria-enricher', agent({
    provider: opus,
    instructions: criteriaEnricherPrompt({ languageInstruction: lang(state.language) }),
  }));

  // ── Test Automation ──────────────────────────────────────────────────────────
  registerAgent('test-automation', agent({
    provider: opus,
    instructions: testAutomationPrompt({ languageInstruction: lang(state.language) }),
  }));

  // ── Coding Machine ───────────────────────────────────────────────────────────
  registerAgent('coding-machine', agent({
    provider: opus,
    instructions: codingMachinePrompt({ languageInstruction: lang(state.language) }),
    tools: [getTaskBoardTool],
  }));

  // ── Fix Planner ──────────────────────────────────────────────────────────────
  registerAgent('fix-planner', agent({
    provider: opus,
    instructions: fixPlannerPrompt({ languageInstruction: lang(state.language) }),
    tools: [getTaskBoardTool],
  }));

  // ── Developer ────────────────────────────────────────────────────────────────
  // The developer loop is long-running — use summarizing() so older
  // task context doesn't crowd out the current task.
  registerAgent('developer', agent({
    provider: opus,
    instructions: developerPrompt({ languageInstruction: lang(state.language) }),
    tools: [getNextTaskTool, getImplementedCodeTool, completeTaskTool],
    maxIterations: 50,
    contextManager: summarizing({
      provider: haiku,
      model: 'claude-haiku-4-5',
      keepRecent: 12,
      summaryPrompt: 'Summarise completed implementation tasks, key decisions, and current progress:',
    }),
  }));

  // ── Code Reviewer ────────────────────────────────────────────────────────────
  registerAgent('code-reviewer', agent({
    provider: opus,
    instructions: reviewerPrompt({ languageInstruction: lang(state.language) }),
    contextManager: slidingWindow(20),
  }));

  // ── Refactorer ───────────────────────────────────────────────────────────────
  registerAgent('refactorer', agent({
    provider: opus,
    instructions: refactorerPrompt({ languageInstruction: lang(state.language) }),
    contextManager: slidingWindow(15),
  }));
}

// ─── agentTool() delegates — used by the main orchestrator ───────────────────

export const pmTool              = agentTool('product-manager',   { description: 'Write a user story from a feature request. Ask clarifying questions if needed.' });
export const threeAmigosTool     = agentTool('amigo-ba',          { toolName: 'three_amigos_meeting', description: 'Run a Three Amigos BDD meeting for the current user story and return enriched acceptance criteria.' });
export const testAutomationTool  = agentTool('test-automation',   { description: 'Write a Gherkin .feature file from the current user story and acceptance criteria.' });
export const codingMachineTool   = agentTool('coding-machine',    { description: 'Plan implementation tasks for the current feature. Adds tasks to the shared task board.' });
export const fixPlannerTool      = agentTool('fix-planner',       { description: 'Analyse failing test output and create fix tasks on the shared task board.' });
export const developerTool       = agentTool('developer',         { description: 'Implement all open tasks on the task board one by one.' });
export const codeReviewerTool    = agentTool('code-reviewer',     { description: 'Review the implemented code for design issues, complexity, and SOLID violations.' });
export const refactorerTool      = agentTool('refactorer',        { description: 'Refactor the implemented files based on the code reviewer\'s feedback.' });
```

---

## `src/index.ts` — Main orchestrator

The top-level orchestrator coordinates the entire workflow. It delegates every phase to the registered agents via tools and handles the test-runner loop in code (deterministic shell command — no need for an LLM here).

```ts
// src/index.ts
import * as fs from 'fs';
import { execSync } from 'child_process';
import { agent, defineTool } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { state, log } from './state.js';
import { setupRegistry } from './registry.js';
import { getFilesystemMcp } from './mcp.js';
import {
  pmTool, threeAmigosTool, testAutomationTool,
  codingMachineTool, fixPlannerTool, developerTool,
  codeReviewerTool, refactorerTool,
} from './registry.js';

// ─── Filesystem MCP tools (write/read files from agents) ─────────────────────

async function buildFileTools() {
  const mcp = await getFilesystemMcp();
  // The MCP server exposes read_file, write_file, list_directory, etc.
  // We surface them as native tools so agents can use them transparently.
  return mcp.tools;
}

// ─── Test runner (deterministic — no LLM needed) ─────────────────────────────

type TestResult = { passed: boolean; summary: string };

function runTests(featureFile: string): TestResult {
  try {
    execSync(`npx cucumber-js ${featureFile} --format summary`, {
      encoding: 'utf8', stdio: 'pipe',
    });
    return { passed: true, summary: '' };
  } catch (err: unknown) {
    const out = (err as { stdout?: string }).stdout ?? String(err);
    return { passed: false, summary: out.slice(0, 3000) };
  }
}

const saveFeatureFileTool = defineTool({
  name: 'save_feature_file',
  description: 'Save the generated Gherkin content to disk and record it in workflow state.',
  schema: (s) => ({
    path: s.string().description('File path, e.g. features/password-reset.feature').required(),
    content: s.string().description('Full Gherkin feature file content').required(),
  }),
  handle: async (input) => {
    fs.mkdirSync('features', { recursive: true });
    fs.writeFileSync(String(input.path), String(input.content), 'utf8');
    state.featureFile = String(input.content);
    return `Feature file saved to ${input.path}`;
  },
});

const getWorkflowContextTool = defineTool({
  name: 'get_workflow_context',
  description: 'Return the current workflow state: user story, acceptance criteria, task board, and review comments.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => JSON.stringify({
    userStory: state.userStory,
    acceptanceCriteria: state.acceptanceCriteria,
    taskBoard: state.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, filePath: t.filePath })),
    reviewComments: state.reviewComments,
  }, null, 2),
});

const updateUserStoryTool = defineTool({
  name: 'update_user_story',
  description: 'Store the finalised user story and acceptance criteria in workflow state.',
  schema: (s) => ({
    userStory: s.string().required(),
    acceptanceCriteria: s.array().items(s.string().toSchema()).description('BDD acceptance criteria').required(),
  }),
  handle: async (input) => {
    state.userStory = String(input.userStory);
    state.acceptanceCriteria = (input.acceptanceCriteria as string[]);
    return 'User story and acceptance criteria saved.';
  },
});

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runDevelopmentWorkflow(
  featureRequest: string,
  options: { language?: string; featureFile?: string; maxFixAttempts?: number } = {},
): Promise<void> {
  const featureFilePath = options.featureFile ?? 'features/new-feature.feature';
  const maxFixAttempts  = options.maxFixAttempts ?? 3;

  state.featureRequest = featureRequest;
  state.language       = options.language ?? 'en';

  // Register all agents with their context managers and prompt templates
  setupRegistry();

  // Attach filesystem MCP tools to agents that need to write files
  const fileTools = await buildFileTools();

  log('WORKFLOW', `Starting: "${featureRequest}" [lang: ${state.language}]`);

  // ── Orchestrator agent ──────────────────────────────────────────────────────
  // The orchestrator only coordinates — it delegates real work to specialist
  // agents via agentTool() and uses state-management tools to pass data between phases.
  const orchestrator = agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are the workflow orchestrator for an AI-driven BDD development process.
Execute each phase in order using the available tools. After each phase, use get_workflow_context
to verify the state before proceeding. Phases:

1. product_manager    — Write user story + acceptance criteria
2. update_user_story  — Persist the output to workflow state
3. three_amigos_meeting — Refine acceptance criteria via BDD meeting
4. test_automation    — Write .feature file; save with save_feature_file
5. coding_machine     — Plan implementation tasks
6. developer          — Implement all tasks (uses filesystem MCP to write files)
7. [test runner runs in code after this step — you do not call it]
8. code_reviewer      — Review the implementation
9. refactorer         — Apply review suggestions

Do not skip phases. Use get_workflow_context between steps to stay oriented.`,
    tools: [
      // Phase delegates
      pmTool, threeAmigosTool, testAutomationTool,
      codingMachineTool, fixPlannerTool, developerTool,
      codeReviewerTool, refactorerTool,
      // State management
      updateUserStoryTool, saveFeatureFileTool, getWorkflowContextTool,
      // Filesystem (from MCP) — passed to orchestrator so it can read outputs
      ...fileTools,
    ],
    maxIterations: 40,
  });

  // Run phases 1–6 (orchestrator drives; test runner runs in code between 6 and 7)
  await orchestrator.prompt(
    `Feature request: "${featureRequest}"\n\nRun phases 1 through 6 (stop before code review). ` +
    `The test runner will execute between the developer and reviewer phases.`
  );

  // ── Test runner + fix loop (deterministic) ──────────────────────────────────
  log('TEST RUNNER', `Running: ${featureFilePath}`);

  for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
    const result = runTests(featureFilePath);

    if (result.passed) {
      log('TEST RUNNER', '✅  All tests pass!');
      break;
    }

    console.log(`\n❌ Tests failed (attempt ${attempt}/${maxFixAttempts})`);
    console.log(result.summary);

    if (attempt === maxFixAttempts) {
      console.log('\n⚠  Max fix attempts reached. Manual intervention needed.');
      break;
    }

    // Let the fix planner and developer handle the failures
    await orchestrator.prompt(
      `Tests failed:\n\n${result.summary}\n\n` +
      `Use fix_planner to plan fix tasks, then developer to implement them.`
    );
  }

  // ── Phases 7–8: review + refactor ──────────────────────────────────────────
  await orchestrator.prompt(
    `Tests are passing. Now run the code_reviewer, then the refactorer if needed. ` +
    `Use get_workflow_context to see the current state first.`
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  const done  = state.tasks.filter((t) => t.status === 'done').length;
  const total = state.tasks.length;

  console.log('\n\n✅  Workflow complete!');
  console.log(`   User Story:      ${state.userStory}`);
  console.log(`   Tasks:           ${done}/${total} done`);
  console.log(`   Feature file:    ${featureFilePath}`);
  console.log(`   Review comments: ${state.reviewComments.length}`);
  console.log(`   Refactored:      ${Object.keys(state.refactoredCode).length} file(s)`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

await runDevelopmentWorkflow(
  'Users should be able to reset their password via email',
  { language: 'en' },
);
```

---

## SDK features at a glance

| SDK feature | Where it's used | Why |
|---|---|---|
| `defineTool()` | `task-tools.ts`, `input-tools.ts`, `index.ts` | Typed tool contracts; input validated before agents touch state |
| `Agent Registry` | `registry.ts` | One place to define every agent; orchestrator delegates with `agentTool()` — never calls agents directly |
| `promptTemplate` | `prompts.ts` | System prompts are typed, reusable, and language-aware — no scattered template strings |
| `slidingWindow` | PM, reviewer, refactorer | Short-lived agents; older context never helps |
| `tokenBudget` | Three Amigos | BDD meetings grow unpredictably — cap by estimated tokens |
| `summarizing` | Developer | Long-running loop; old task history compresses, keeping the current task in focus |
| `connectMcp()` | `mcp.ts` | Filesystem and GitHub servers expose `read_file`, `write_file`, `create_pull_request` as native tools without hand-rolling wrappers |

## Why this structure works

**Blackboard pattern.** `WorkflowState` is the single source of truth. Agents don't hand off data to each other — they read from and write to the shared state. The orchestrator never needs to parse agent output to extract data; it uses dedicated state tools (`update_user_story`, `save_feature_file`) for that.

**Human escalation is a tool, not a branch.** `ask_user` is a `defineTool()` call that any agent can invoke. Agents try to resolve questions among themselves first; the tool blocks on stdin only when truly needed. A well-specified feature may complete with zero interruptions.

**The test runner is not an agent.** Running `cucumber-js` is deterministic. There's no reason to involve an LLM. The fix loop (plan → implement → re-run) is triggered in code based on the exit code.

**`agentTool()` keeps the orchestrator thin.** The orchestrator doesn't know how the developer implements code or how the reviewer assesses it. It just calls `developer({ task: '...' })` and trusts the result. Swapping out an agent (e.g. replacing the reviewer with a stricter one) requires changing one line in `registry.ts`.

**Context managers match agent lifetimes.** The developer loop is unbounded — `summarizing()` keeps the current task in focus while compressing completed history. Short-lived agents (PM, reviewer) use `slidingWindow` to stay lean.
