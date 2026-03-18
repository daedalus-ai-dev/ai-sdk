# Example: AI-Driven Development Workflow

**Patterns used:** [Prompt Chaining](../patterns/prompt-chaining) · [Orchestrator-Workers](../patterns/orchestrator-workers) · [Evaluator-Optimizer](../patterns/evaluator-optimizer)

**SDK features:** `defineTool` · `Agent Registry` · `promptTemplate` · `slidingWindow` / `tokenBudget` / `summarizing` · `connectMcp`

**External MCP servers:** Filesystem · [GitNexus](https://github.com/abhigyanpatwari/GitNexus) (codebase intelligence) · GitHub

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
 Coding Machine  (GitNexus query → plan tasks: open → in_progress → done)
      │
      ▼
 Developer ◄──── loop: GitNexus impact → implement → detect_changes ────────┐
      │                                                                       │
      ▼                                                                       │
 Test Runner ──── fail? ──► Coding Machine (fix tasks) ────────────────────┘
      │
  tests pass
      │
      ▼
 Code Reviewer  (GitNexus context on changed symbols · SOLID · DRY)
      │
      ▼
 Refactorer  (GitNexus rename for safe symbol changes · write_file via MCP)
      │
      ▼
   Done ✓
```

## Project structure

```
ai-dev-workflow/
├── package.json
├── tsconfig.json
├── .gitnexus/                         # GitNexus index (run: npx gitnexus analyze)
├── features/                          # Generated Gherkin files (git-committed)
│   └── password-reset.feature
├── step-definitions/                  # Cucumber step definitions (generated)
│   └── password-reset.steps.ts
└── src/
    ├── index.ts                       # Entry point — orchestrates the full workflow
    ├── state.ts                       # Shared WorkflowState (blackboard)
    ├── prompts.ts                     # promptTemplate definitions (per coding language)
    ├── mcp.ts                         # connectMcp() — filesystem, GitNexus, GitHub
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
    "test:features": "cucumber-js features/**/*.feature",
    "gitnexus:index": "npx gitnexus analyze"
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

> **Before running:** index the codebase so GitNexus can answer questions about it:
> ```bash
> npx gitnexus analyze --embeddings
> ```

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

export type CodingLanguage = 'typescript' | 'go' | 'flutter' | 'python' | 'rust';

export type WorkflowState = {
  featureRequest: string;
  projectPath: string;                       // absolute path to the target project
  codingLanguage: CodingLanguage;            // target implementation language
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
  projectPath: '',
  codingLanguage: 'typescript',
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

All agent system prompts live here, defined with `promptTemplate`. The `codingLanguage` variable injects language-specific style rules, idioms, and file conventions into every agent — so the same workflow produces idiomatic TypeScript, Go, Flutter, or Rust without any other changes.

```ts
// src/prompts.ts
import { promptTemplate } from '@daedalus-ai-dev/ai-sdk';
import type { CodingLanguage } from './state.js';

// ─── Per-language style instructions ─────────────────────────────────────────

const codeStyle: Record<CodingLanguage, string> = {
  typescript: `Target language: TypeScript (ESM, strict mode).
- Use explicit types; never use \`any\`
- Prefer \`async/await\` over callbacks; return \`Promise<T>\` explicitly
- Use \`Result\`-style error handling (throw typed errors, not strings)
- File extension: .ts; imports must include .js extension for ESM`,

  go: `Target language: Go.
- Follow standard Go project layout (cmd/, internal/, pkg/)
- Return errors as the last value; never panic in library code
- Use interfaces for abstraction; keep them small (1–3 methods)
- Favour explicit over clever; no magic
- File extension: .go; package names are lowercase, single word`,

  flutter: `Target language: Dart / Flutter.
- Use StatelessWidget where possible; StatefulWidget only when local state is needed
- Prefer composition over inheritance for widgets
- Use \`const\` constructors wherever possible for performance
- Separate business logic from UI (BLoC or Riverpod pattern)
- File extension: .dart; snake_case filenames`,

  python: `Target language: Python 3.12+.
- Use type hints on all public functions and classes
- Follow PEP 8; use dataclasses or Pydantic for data models
- Prefer \`pathlib\` over \`os.path\`; \`asyncio\` for I/O-bound work
- File extension: .py; snake_case filenames and identifiers`,

  rust: `Target language: Rust (2021 edition).
- Use \`Result<T, E>\` for fallible operations; avoid \`unwrap()\` in library code
- Derive \`Debug\`, \`Clone\`, \`PartialEq\` where useful
- Prefer iterator combinators over explicit loops
- File extension: .rs; snake_case filenames; modules mirror directory structure`,
};

export function style(lang: CodingLanguage): string {
  return codeStyle[lang];
}

// ─── Product Manager ──────────────────────────────────────────────────────────

export const pmPrompt = promptTemplate`You are a senior product manager.
Given a feature request, write a crisp user story and acceptance criteria.
If the request is too vague to write testable criteria, set ready=false and list clarifying questions.
User story format: "As a [persona], I want [goal], so that [benefit]."
Acceptance criteria: specific, testable, BDD-style "Given/When/Then" statements.`;

// ─── Three Amigos ─────────────────────────────────────────────────────────────

export const amigoPrompt = promptTemplate`You are a ${'role'} in a Three Amigos BDD meeting.
${'perspective'}
For each question you raise, also try to answer it from your expertise.
If you cannot answer it confidently, mark the answer as "NEEDS_PO".`;

export const criteriaEnricherPrompt = promptTemplate`You refine BDD acceptance criteria based on meeting notes.
Keep all existing criteria and add new ones discovered in the meeting.`;

// ─── Test Automation ──────────────────────────────────────────────────────────

export const testAutomationPrompt = promptTemplate`You are a test automation engineer writing Cucumber/Gherkin .feature files.
${'codeStyle'}
Rules:
- Each acceptance criterion becomes one or more Scenario or Scenario Outline
- Use concrete, realistic test data (not "foo", "bar", or "123")
- Include at least one negative path per feature
- Step text should read like natural English — no jargon
- The file will be executable but FAIL until implementation is complete`;

// ─── Coding Machine ───────────────────────────────────────────────────────────

export const codingMachinePrompt = promptTemplate`You are a senior engineer planning a feature implementation.
${'codeStyle'}
Before planning, use gitnexus_query to search for existing related code so tasks don't duplicate work.
Use gitnexus_context on any existing symbol that the new feature will touch.
Break the feature into focused, independently implementable tasks.
Each task maps to a single file or well-scoped module.
Order by dependency: foundational code first, integration last.`;

export const fixPlannerPrompt = promptTemplate`You are a senior engineer triaging failing BDD tests.
${'codeStyle'}
Use gitnexus_query to find the code related to failing steps before planning fixes.
Each fix task must reference the exact failing step and the file to change.`;

// ─── Developer ────────────────────────────────────────────────────────────────

export const developerPrompt = promptTemplate`You are a senior developer implementing a feature task by task.
${'codeStyle'}
Workflow per task:
1. get_next_task — claim the next open task
2. gitnexus_impact — run impact analysis on any symbol you plan to change; abort if risk is HIGH/CRITICAL without user confirmation
3. get_implemented_code — read what already exists; stay consistent
4. write_file (MCP) — write the implementation
5. complete_task — mark the task done
6. gitnexus_detect_changes — verify your changes match the expected scope
Repeat until get_next_task returns NO_TASKS.`;

// ─── Code Reviewer ────────────────────────────────────────────────────────────

export const reviewerPrompt = promptTemplate`You are a principal engineer doing a thorough code review.
${'codeStyle'}
Use gitnexus_context on each changed symbol to see all callers and usages before commenting.
Review against:
- SOLID principles (especially SRP and OCP)
- DRY — flag duplication that should be extracted
- Separation of concerns — business logic must not mix with I/O or framework code
- Complexity — functions with cyclomatic complexity > 3 deserve scrutiny
- Naming — names must reveal intent without a comment
For each issue: what it is, why it matters, specific refactoring suggestion.`;

// ─── Refactorer ───────────────────────────────────────────────────────────────

export const refactorerPrompt = promptTemplate`You are a principal engineer refactoring code based on review feedback.
${'codeStyle'}
For symbol renames, ALWAYS use gitnexus_rename (dry_run first, then apply) — never find-and-replace.
Use read_file (MCP) to read the current file before making changes.
Use write_file (MCP) to save the refactored version.
Do NOT change behaviour — only structure, naming, and organisation.
Preserve all existing function signatures that are used externally.`;
```

---

## `src/mcp.ts` — MCP connections

Three MCP servers power the workflow: filesystem for file I/O, GitNexus for codebase intelligence, and GitHub for PR creation.

```ts
// src/mcp.ts
import { connectMcp } from '@daedalus-ai-dev/ai-sdk';
import type { McpConnection } from '@daedalus-ai-dev/ai-sdk';
import * as path from 'path';

// ─── Filesystem ───────────────────────────────────────────────────────────────

let _fs: McpConnection | null = null;

/**
 * Filesystem MCP server — exposes read_file, write_file, list_directory, etc.
 * Scoped to `projectPath` so generated files land in the target project,
 * not in the workflow tool's own directory.
 */
export async function getFilesystemMcp(projectPath: string): Promise<McpConnection> {
  if (_fs) return _fs;
  _fs = await connectMcp({
    type: 'stdio',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      path.resolve(projectPath),   // ← target project, not process.cwd()
    ],
  });
  console.log(`✓ Filesystem MCP connected → ${projectPath}`);
  return _fs;
}

// ─── GitNexus ─────────────────────────────────────────────────────────────────

let _gitnexus: McpConnection | null = null;

/**
 * GitNexus MCP server — exposes codebase intelligence tools:
 *   gitnexus_query, gitnexus_context, gitnexus_impact,
 *   gitnexus_detect_changes, gitnexus_rename, gitnexus_cypher
 *
 * Pointed at `projectPath` so GitNexus analyses the target project's index.
 * Requires the index to be up to date: `npx gitnexus analyze` inside the project.
 */
export async function getGitnexusMcp(projectPath: string): Promise<McpConnection> {
  if (_gitnexus) return _gitnexus;
  _gitnexus = await connectMcp({
    type: 'stdio',
    command: 'npx',
    args: ['gitnexus', 'mcp'],
    env: { GITNEXUS_REPO: path.resolve(projectPath) },  // ← target project
  });
  console.log(`✓ GitNexus MCP connected → ${projectPath}`);
  return _gitnexus;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

/**
 * GitHub MCP server — used at the end of the workflow to create a PR.
 * Requires GITHUB_TOKEN in the environment.
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

/** Mark a task done and record it in state. */
export const completeTaskTool = defineTool({
  name: 'complete_task',
  description: 'Mark a task as done after its file has been written.',
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

/** Return all completed code for context before starting a new task. */
export const getImplementedCodeTool = defineTool({
  name: 'get_implemented_code',
  description: 'Return all already-implemented files for context. Read before starting a new task.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    const done = state.tasks.filter((t) => t.status === 'done' && t.implementation);
    if (done.length === 0) return 'Nothing implemented yet.';
    return done.map((t: Task) => `// ── ${t.filePath} ──\n${t.implementation}`).join('\n\n');
  },
});

/** Return the full task board. */
export const getTaskBoardTool = defineTool({
  name: 'get_task_board',
  description: 'Return the current task board with all tasks and their statuses.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    if (state.tasks.length === 0) return 'Task board is empty.';
    return state.tasks
      .map((t: Task) => `[${t.status.toUpperCase().padEnd(11)}] ${t.id}: ${t.title} → ${t.filePath}`)
      .join('\n');
  },
});
```

---

## `src/tools/input-tools.ts` — Human-in-the-loop

```ts
// src/tools/input-tools.ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import * as readline from 'readline';

export const askUserTool = defineTool({
  name: 'ask_user',
  description: 'Ask the human a question and wait for their answer. Only use this when no agent can resolve the question.',
  schema: (s) => ({
    question: s.string().description('The question to ask').required(),
    context: s.string().description('Brief context for why this is being asked').required(),
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

All agents are registered here. GitNexus tools are passed to the agents that need codebase intelligence — the coding machine, developer, reviewer, and refactorer. The orchestrator delegates to all of them via `agentTool()`.

```ts
// src/registry.ts
import {
  registerAgent, agentTool, agent,
  slidingWindow, summarizing, tokenBudget,
} from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import {
  pmPrompt, amigoPrompt, criteriaEnricherPrompt,
  testAutomationPrompt, codingMachinePrompt, fixPlannerPrompt,
  developerPrompt, reviewerPrompt, refactorerPrompt, style,
} from './prompts.js';
import {
  getNextTaskTool, completeTaskTool,
  getImplementedCodeTool, getTaskBoardTool,
} from './tools/task-tools.js';
import { askUserTool } from './tools/input-tools.js';
import { state } from './state.js';
import type { McpConnection } from '@daedalus-ai-dev/ai-sdk';

const opus  = anthropic('claude-opus-4-6');
const haiku = anthropic('claude-haiku-4-5');

export function setupRegistry(
  fsMcp: McpConnection,
  gitnexusMcp: McpConnection,
): void {
  const fsTools        = fsMcp.tools;          // read_file, write_file, list_directory, …
  const gitnexusTools  = gitnexusMcp.tools;    // gitnexus_query, gitnexus_impact, gitnexus_context,
                                               // gitnexus_detect_changes, gitnexus_rename, …

  const lang = style(state.codingLanguage);

  // ── Product Manager ──────────────────────────────────────────────────────────
  registerAgent('product-manager', agent({
    provider: haiku,
    instructions: pmPrompt({}),
    tools: [askUserTool],
    contextManager: slidingWindow(10),
  }));

  // ── Three Amigos — Business Analyst ──────────────────────────────────────────
  registerAgent('amigo-ba', agent({
    provider: haiku,
    instructions: amigoPrompt({
      role: 'Business Analyst',
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
      perspective: 'Focus on error scenarios, boundary values, data validation, and non-functional requirements.',
    }),
    tools: [askUserTool],
    contextManager: tokenBudget(4000),
  }));

  // ── Criteria Enricher ────────────────────────────────────────────────────────
  registerAgent('criteria-enricher', agent({
    provider: opus,
    instructions: criteriaEnricherPrompt({}),
  }));

  // ── Test Automation ──────────────────────────────────────────────────────────
  registerAgent('test-automation', agent({
    provider: opus,
    instructions: testAutomationPrompt({ codeStyle: lang }),
  }));

  // ── Coding Machine ───────────────────────────────────────────────────────────
  // Has gitnexus_query + gitnexus_context so it searches existing code
  // before planning tasks — avoids duplicating work that already exists.
  registerAgent('coding-machine', agent({
    provider: opus,
    instructions: codingMachinePrompt({ codeStyle: lang }),
    tools: [getTaskBoardTool, ...gitnexusTools],
  }));

  // ── Fix Planner ──────────────────────────────────────────────────────────────
  registerAgent('fix-planner', agent({
    provider: opus,
    instructions: fixPlannerPrompt({ codeStyle: lang }),
    tools: [getTaskBoardTool, ...gitnexusTools],
  }));

  // ── Developer ────────────────────────────────────────────────────────────────
  // Long-running loop: summarizing() compresses completed task history
  // so the current task always has a clean, focused context window.
  // gitnexus_impact runs before every symbol change; gitnexus_detect_changes
  // verifies scope after each task.
  registerAgent('developer', agent({
    provider: opus,
    instructions: developerPrompt({ codeStyle: lang }),
    tools: [
      getNextTaskTool,
      getImplementedCodeTool,
      completeTaskTool,
      ...fsTools,         // write_file, read_file (no raw fs calls)
      ...gitnexusTools,   // gitnexus_impact, gitnexus_detect_changes
    ],
    maxIterations: 50,
    contextManager: summarizing({
      provider: haiku,
      model: 'claude-haiku-4-5',
      keepRecent: 12,
      summaryPrompt: 'Summarise completed tasks, key decisions, and current progress. Be concise:',
    }),
  }));

  // ── Code Reviewer ────────────────────────────────────────────────────────────
  // gitnexus_context lets the reviewer see all callers of a changed symbol
  // before commenting — avoids flagging changes that are intentionally breaking.
  registerAgent('code-reviewer', agent({
    provider: opus,
    instructions: reviewerPrompt({ codeStyle: lang }),
    tools: [...fsTools, ...gitnexusTools],
    contextManager: slidingWindow(20),
  }));

  // ── Refactorer ───────────────────────────────────────────────────────────────
  // gitnexus_rename does a graph-aware multi-file rename instead of
  // find-and-replace. write_file (MCP) saves results without raw fs.
  registerAgent('refactorer', agent({
    provider: opus,
    instructions: refactorerPrompt({ codeStyle: lang }),
    tools: [...fsTools, ...gitnexusTools],
    contextManager: slidingWindow(15),
  }));
}

// ─── agentTool() delegates ────────────────────────────────────────────────────

export const pmTool             = agentTool('product-manager',  { description: 'Write a user story from a feature request. Ask clarifying questions if needed.' });
export const threeAmigosTool    = agentTool('amigo-ba',         { toolName: 'three_amigos_meeting', description: 'Run a Three Amigos BDD meeting and return enriched acceptance criteria.' });
export const testAutomationTool = agentTool('test-automation',  { description: 'Write a Gherkin .feature file from the current user story and acceptance criteria.' });
export const codingMachineTool  = agentTool('coding-machine',   { description: 'Query existing code with GitNexus, then plan implementation tasks for the feature.' });
export const fixPlannerTool     = agentTool('fix-planner',      { description: 'Analyse failing test output and create fix tasks.' });
export const developerTool      = agentTool('developer',        { description: 'Implement all open tasks one by one, running impact analysis before each change.' });
export const codeReviewerTool   = agentTool('code-reviewer',    { description: 'Review the implementation using GitNexus context on changed symbols.' });
export const refactorerTool     = agentTool('refactorer',       { description: 'Refactor files based on review feedback. Use gitnexus_rename for symbol renames.' });
```

---

## `src/index.ts` — Main orchestrator

```ts
// src/index.ts
import * as fs from 'fs';
import { execSync } from 'child_process';
import { agent, defineTool } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { state, log } from './state.js';
import type { CodingLanguage } from './state.js';
import { setupRegistry } from './registry.js';
import { getFilesystemMcp, getGitnexusMcp } from './mcp.ts';
import {
  pmTool, threeAmigosTool, testAutomationTool,
  codingMachineTool, fixPlannerTool, developerTool,
  codeReviewerTool, refactorerTool,
} from './registry.js';

// ─── State management tools (used by the orchestrator) ───────────────────────

const saveFeatureFileTool = defineTool({
  name: 'save_feature_file',
  description: 'Save generated Gherkin content to disk inside the target project and record it in state.',
  schema: (s) => ({
    relativePath: s.string().description('Relative path inside the project, e.g. features/password-reset.feature').required(),
    content: s.string().description('Full Gherkin .feature content').required(),
  }),
  handle: async (input) => {
    const fullPath = path.join(state.projectPath, String(input.relativePath));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, String(input.content), 'utf8');
    state.featureFile = String(input.content);
    return `Feature file saved to ${fullPath}`;
  },
});

const updateUserStoryTool = defineTool({
  name: 'update_user_story',
  description: 'Persist the finalised user story and acceptance criteria in state.',
  schema: (s) => ({
    userStory: s.string().required(),
    acceptanceCriteria: s.array().items(s.string().toSchema()).required(),
  }),
  handle: async (input) => {
    state.userStory = String(input.userStory);
    state.acceptanceCriteria = input.acceptanceCriteria as string[];
    return 'User story and acceptance criteria saved.';
  },
});

const getWorkflowContextTool = defineTool({
  name: 'get_workflow_context',
  description: 'Return the current workflow state snapshot.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => JSON.stringify({
    codingLanguage: state.codingLanguage,
    userStory: state.userStory,
    acceptanceCriteria: state.acceptanceCriteria,
    taskBoard: state.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, filePath: t.filePath })),
    reviewComments: state.reviewComments.length,
  }, null, 2),
});

// ─── Test runner (deterministic — no LLM) ────────────────────────────────────

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

// ─── Main workflow ────────────────────────────────────────────────────────────

export async function runDevelopmentWorkflow(
  featureRequest: string,
  options: {
    projectPath: string;                     // absolute path to the target project
    codingLanguage?: CodingLanguage;
    featureFile?: string;                    // relative to projectPath
    maxFixAttempts?: number;
  },
): Promise<void> {
  const projectPath     = path.resolve(options.projectPath);
  const featureFilePath = path.join(projectPath, options.featureFile ?? 'features/new-feature.feature');
  const maxFixAttempts  = options.maxFixAttempts ?? 3;

  state.featureRequest  = featureRequest;
  state.projectPath     = projectPath;
  state.codingLanguage  = options.codingLanguage ?? 'typescript';

  // Connect MCP servers scoped to the target project (lazy singletons)
  const [fsMcp, gitnexusMcp] = await Promise.all([
    getFilesystemMcp(projectPath),
    getGitnexusMcp(projectPath),
  ]);

  // Register all agents (prompts, context managers, tools all wired here)
  setupRegistry(fsMcp, gitnexusMcp);

  log('WORKFLOW', `"${featureRequest}" [${state.codingLanguage}]`);

  // ── Orchestrator ──────────────────────────────────────────────────────────
  const orchestrator = agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are the workflow orchestrator for an AI-driven BDD development process.
Execute each phase in order. Use get_workflow_context between phases to stay oriented.

Target project: ${projectPath}
Coding language: ${state.codingLanguage}

All file paths passed to agents and tools must be absolute paths inside: ${projectPath}

Phases:
1. product_manager          — Clarify requirements; write user story + acceptance criteria
2. update_user_story        — Persist to state
3. three_amigos_meeting     — Refine criteria via BDD meeting
4. test_automation          — Generate .feature file; persist with save_feature_file
5. coding_machine           — Query existing code (GitNexus), plan implementation tasks
6. developer                — Implement all tasks (impact analysis → write → detect_changes)
[test runner runs here in code — you do not call it]
7. code_reviewer            — Review using GitNexus context on changed symbols
8. refactorer               — Apply suggestions; use gitnexus_rename for safe renames

Do not skip phases.`,
    tools: [
      pmTool, threeAmigosTool, testAutomationTool,
      codingMachineTool, fixPlannerTool, developerTool,
      codeReviewerTool, refactorerTool,
      updateUserStoryTool, saveFeatureFileTool, getWorkflowContextTool,
    ],
    maxIterations: 40,
  });

  // Run phases 1–6
  await orchestrator.prompt(
    `Feature request: "${featureRequest}"\n\n` +
    `Run phases 1 through 6 only (stop before code review — the test runner runs between phase 6 and 7).`
  );

  // ── Test runner + fix loop ────────────────────────────────────────────────
  log('TEST RUNNER', featureFilePath);

  for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
    const result = runTests(featureFilePath);

    if (result.passed) {
      log('TEST RUNNER', '✅  All tests pass!');
      break;
    }

    console.log(`\n❌ Tests failed (attempt ${attempt}/${maxFixAttempts})\n${result.summary}`);

    if (attempt === maxFixAttempts) {
      console.log('\n⚠  Max attempts reached. Manual intervention needed.');
      break;
    }

    await orchestrator.prompt(
      `Tests failed:\n\n${result.summary}\n\n` +
      `Use fix_planner to plan fix tasks, then developer to implement them.`
    );
  }

  // ── Phases 7–8: review + refactor ────────────────────────────────────────
  await orchestrator.prompt(
    `Tests are passing. Run code_reviewer (use GitNexus context on changed symbols), ` +
    `then refactorer if needed (use gitnexus_rename for any symbol renames). ` +
    `Use get_workflow_context first.`
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  const done  = state.tasks.filter((t) => t.status === 'done').length;
  const total = state.tasks.length;

  console.log('\n\n✅  Workflow complete!');
  console.log(`   Project:         ${projectPath}`);
  console.log(`   Language:        ${state.codingLanguage}`);
  console.log(`   User Story:      ${state.userStory}`);
  console.log(`   Tasks:           ${done}/${total} done`);
  console.log(`   Feature file:    ${featureFilePath}`);
  console.log(`   Review comments: ${state.reviewComments.length}`);
  console.log(`   Refactored:      ${Object.keys(state.refactoredCode).length} file(s)`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

await runDevelopmentWorkflow(
  'Users should be able to reset their password via email',
  {
    projectPath: '/Users/alice/projects/my-api',   // ← the project to work on
    codingLanguage: 'typescript',
  },
);

// Other examples:
// await runDevelopmentWorkflow('Add a health check endpoint', {
//   projectPath: '/Users/alice/projects/my-go-service',
//   codingLanguage: 'go',
// });
// await runDevelopmentWorkflow('Show a loading spinner during network requests', {
//   projectPath: '/Users/alice/projects/my-flutter-app',
//   codingLanguage: 'flutter',
// });
```

---

## SDK features and MCP servers at a glance

| Feature | Where | Why |
|---|---|---|
| `defineTool()` | `task-tools.ts`, `input-tools.ts`, `index.ts` | Typed contracts; input validated before any agent touches shared state |
| `Agent Registry` | `registry.ts` | One place for all agents; orchestrator delegates via `agentTool()` — never imports agent functions directly |
| `promptTemplate` | `prompts.ts` | System prompts are typed; `codeStyle` injects language-specific idioms, file conventions, and error handling patterns into every agent |
| `slidingWindow` | PM, reviewer, refactorer | Short-lived agents; older context never helps |
| `tokenBudget` | Three Amigos | BDD meetings grow unpredictably; cap by estimated token count |
| `summarizing` | Developer | Long-running loop; `claude-haiku-4-5` compresses completed task history so the current task always gets a clean context |
| `connectMcp()` (filesystem) | `mcp.ts` → developer, refactorer | File I/O without raw `fs` calls scattered across the codebase |
| `connectMcp()` (GitNexus) | `mcp.ts` → coding-machine, developer, reviewer, refactorer | Codebase intelligence: query before planning, impact before editing, detect_changes after, rename safely |
| `connectMcp()` (GitHub) | `mcp.ts` (optional) | `create_pull_request` at workflow end — no GitHub API client needed |

### GitNexus tool usage per agent

| Agent | GitNexus tools used | Purpose |
|---|---|---|
| Coding Machine | `gitnexus_query`, `gitnexus_context` | Find existing code before planning; avoid duplicate work |
| Fix Planner | `gitnexus_query` | Locate code related to failing steps |
| Developer | `gitnexus_impact`, `gitnexus_detect_changes` | Check blast radius before editing; verify scope after |
| Code Reviewer | `gitnexus_context` | See all callers of a changed symbol before commenting |
| Refactorer | `gitnexus_rename` | Graph-aware multi-file rename — not find-and-replace |

## Why this structure works

**`codingLanguage` as a first-class parameter.** Every agent system prompt receives the same language-specific style block via `promptTemplate`. Changing from TypeScript to Go is a one-line change at the entry point — every agent immediately writes idiomatic Go, including the test automation engineer, coding machine, and refactorer.

**GitNexus closes the feedback loop on existing code.** Without it, the coding machine plans tasks that duplicate existing functions. With it, `gitnexus_query` finds related code before planning, `gitnexus_impact` prevents silent breakage during implementation, and `gitnexus_rename` makes the refactorer's symbol changes safe across the entire call graph.

**MCP servers as shared infrastructure.** Both the filesystem and GitNexus servers are lazy singletons connected once and passed into `setupRegistry()`. Every agent that needs them receives the live tool list — no wrapper code, no duplication.

**The test runner is not an agent.** `cucumber-js` exit code is the ground truth. There's no benefit to asking an LLM whether tests passed. The fix loop (plan → implement → re-run) is triggered in code, which makes the control flow explicit and auditable.
