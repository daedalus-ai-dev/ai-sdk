# Example: AI-Driven Development Workflow

**Patterns used:** [Prompt Chaining](../patterns/prompt-chaining) · [Orchestrator-Workers](../patterns/orchestrator-workers) · [Evaluator-Optimizer](../patterns/evaluator-optimizer)

**SDK features:** `defineTool` · `Agent Registry` · `promptTemplate` · `slidingWindow` / `tokenBudget` / `summarizing` · `connectMcp`

**External MCP servers:** Filesystem · [GitNexus](https://github.com/abhigyanpatwari/GitNexus) (codebase intelligence) · GitHub

A full development lifecycle driven by AI agents — from a raw feature request to clean, reviewed, passing code. Agents handle every step autonomously and escalate to a human only when they genuinely can't resolve something themselves.

```
projectPath + codingLanguage
      │
      ▼
 Project Scaffolder  (init toolchain · install BDD runner · index GitNexus · smoke test)
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
    ├── lsp.ts                         # LSP client — defineTool() wrappers (optional)
    ├── registry.ts                    # registerAgent() — all agents in one place
    ├── scaffolder.ts                  # Project Scaffolder — init, BDD runner, GitNexus
    └── tools/
        ├── task-tools.ts              # defineTool() — task queue management
        ├── input-tools.ts             # defineTool() — stdin prompting
        └── shell-tools.ts             # defineTool() — run shell commands in projectPath
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
Before planning:
- Use gitnexus_query to search for existing related code (avoid duplicating work).
- Use lsp_workspace_symbol to check if a specific function or type already exists by exact name.
- Use gitnexus_context on any existing symbol the new feature will touch.
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
2. gitnexus_impact — run impact analysis on any symbol you plan to change; abort if HIGH/CRITICAL without user confirmation
3. lsp_find_references — if changing an existing function signature, verify all call sites first
4. get_implemented_code — read what already exists; stay consistent
5. lsp_hover — use to check types of symbols you're calling while writing
6. write_file (MCP) — write the implementation
7. complete_task — mark the task done
8. gitnexus_detect_changes — verify your changes match the expected scope
Repeat until get_next_task returns NO_TASKS.`;

// ─── Code Reviewer ────────────────────────────────────────────────────────────

export const reviewerPrompt = promptTemplate`You are a principal engineer doing a thorough code review.
${'codeStyle'}
Before commenting on a changed symbol:
- Use gitnexus_context to see all callers in the knowledge graph.
- Use lsp_incoming_calls for a live call hierarchy from the language server (more current than the index).
- Use lsp_document_symbols to get a quick overview of all symbols in a changed file.
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
For symbol renames:
1. Use lsp_find_references to see every usage across the project.
2. Use gitnexus_rename with dry_run=true to preview the graph-aware rename.
3. Apply with dry_run=false — never use find-and-replace.
Use read_file (MCP) to read the current file before making changes.
Use write_file (MCP) to save the refactored version.
Do NOT change behaviour — only structure, naming, and organisation.`;
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

## `src/tools/shell-tools.ts` — Shell execution tool

The scaffolder needs to run real shell commands (`npm init`, `go mod tidy`, `flutter create`, etc.). This `defineTool()` wraps `execSync` scoped to the project directory and is **only given to the scaffolder** — no other agent needs it.

```ts
// src/tools/shell-tools.ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import { execSync } from 'child_process';
import { state } from '../state.js';

export const runCommandTool = defineTool({
  name: 'run_command',
  description: 'Run a shell command inside the target project directory. Use for package managers, project init, and tooling setup only. Do not use for file I/O — use the filesystem MCP tools for that.',
  schema: (s) => ({
    command: s.string().description('The shell command to run, e.g. "npm install --save-dev @cucumber/cucumber"').required(),
    reason:  s.string().description('One-line explanation of why this command is needed').required(),
  }),
  handle: async (input) => {
    console.log(`  $ ${input.command}  (${input.reason})`);
    try {
      const output = execSync(String(input.command), {
        cwd: state.projectPath,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const msg = (err as { stderr?: string; message?: string }).stderr
        ?? (err as { message?: string }).message
        ?? String(err);
      return `ERROR: ${msg.slice(0, 1000)}`;
    }
  },
});
```

---

## `src/scaffolder.ts` — Project Scaffolder

Runs once at the very start of the workflow. It creates the project directory, initialises the language-specific toolchain, installs the BDD test runner for that language, sets up GitNexus, and runs a smoke test to confirm everything works before the Product Manager writes a single word.

```ts
// src/scaffolder.ts
import { agent, defineTool } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { state, log } from './state.js';
import { runCommandTool } from './tools/shell-tools.js';
import type { McpConnection } from '@daedalus-ai-dev/ai-sdk';
import type { CodingLanguage } from './state.js';

// ─── Per-language setup knowledge ────────────────────────────────────────────

const scaffoldGuide: Record<CodingLanguage, string> = {
  typescript: `
Initialise a TypeScript project with BDD support:
1. run_command: mkdir -p src features step-definitions
2. run_command: npm init -y
3. run_command: npm install --save-dev typescript tsx @types/node @cucumber/cucumber
4. write_file: tsconfig.json  (strict: true, module: NodeNext, moduleResolution: NodeNext, outDir: dist)
5. write_file: cucumber.json  ({ "require": ["step-definitions/**/*.ts"], "import": ["step-definitions/**/*.ts"] })
6. run_command: npm pkg set scripts.test="cucumber-js"
7. run_command: npm pkg set scripts.test:run="cucumber-js --exit"
Smoke test: run_command: npx tsc --noEmit && echo OK
`,
  go: `
Initialise a Go project with Godog (BDD) support:
1. run_command: go mod init $(basename $PWD)
2. run_command: go get github.com/cucumber/godog/cmd/godog@latest
3. mkdir -p features internal cmd
4. write_file: features/.gitkeep
5. write_file: cmd/main.go  (minimal main package)
6. write_file: Makefile  (test target: godog)
Smoke test: run_command: go build ./...
`,
  flutter: `
Initialise a Flutter project with BDD support:
1. run_command: flutter create . --project-name=$(basename $PWD)
2. run_command: flutter pub add --dev bdd_widget_test build_runner
3. run_command: flutter pub get
4. mkdir -p features test
Smoke test: run_command: flutter analyze
`,
  python: `
Initialise a Python project with Behave (BDD) support:
1. run_command: python3 -m venv .venv
2. run_command: .venv/bin/pip install behave pytest
3. mkdir -p features/steps src
4. write_file: pyproject.toml  (basic project metadata)
5. write_file: features/environment.py  (empty behave environment file)
Smoke test: run_command: .venv/bin/behave --dry-run 2>&1 || echo OK
`,
  rust: `
Initialise a Rust project with Cucumber (BDD) support:
1. run_command: cargo init
2. run_command: cargo add --dev cucumber tokio
3. mkdir -p tests/features
4. write_file: tests/cucumber.rs  (minimal Cucumber test harness)
5. write_file: Cargo.toml  (add [[test]] section for cucumber runner)
Smoke test: run_command: cargo check
`,
};

// ─── GitNexus index tool ──────────────────────────────────────────────────────

const indexWithGitnexusTool = defineTool({
  name: 'index_with_gitnexus',
  description: 'Run "npx gitnexus analyze" in the project directory to build the codebase knowledge graph. Call this after the project structure is in place.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    try {
      execSync('npx gitnexus analyze', {
        cwd: state.projectPath,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return 'GitNexus index built successfully.';
    } catch (err: unknown) {
      const msg = (err as { stderr?: string; message?: string }).stderr ?? String(err);
      return `GitNexus indexing failed: ${msg.slice(0, 500)}`;
    }
  },
});

const verifyProjectReadyTool = defineTool({
  name: 'verify_project_ready',
  description: 'Report the current state of the project directory — files present, key config files, and whether the smoke test passed.',
  schema: (s) => ({ _: s.string().description('Pass empty string').required() }),
  handle: async () => {
    const files = fs.readdirSync(state.projectPath).slice(0, 30);
    return JSON.stringify({ projectPath: state.projectPath, files }, null, 2);
  },
});

// ─── Scaffolder agent ─────────────────────────────────────────────────────────

export async function scaffoldProject(fsMcp: McpConnection): Promise<void> {
  log('SCAFFOLDER', `${state.projectPath}  [${state.codingLanguage}]`);

  fs.mkdirSync(state.projectPath, { recursive: true });

  await agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are a project scaffolding engineer.
Set up a new ${state.codingLanguage} project at: ${state.projectPath}

Follow this guide exactly:
${scaffoldGuide[state.codingLanguage]}

After the project structure is ready:
- Call index_with_gitnexus to build the codebase knowledge graph.
- Call verify_project_ready and confirm the directory looks correct.
- Report any errors clearly so the user can fix them before continuing.

Use run_command for all shell operations.
Use the filesystem MCP tools (write_file, create_directory) for file creation.
Do NOT write source files that belong to the feature — only scaffolding and config.`,
    tools: [
      runCommandTool,
      indexWithGitnexusTool,
      verifyProjectReadyTool,
      ...fsMcp.tools,   // write_file, create_directory, list_directory
    ],
    maxIterations: 30,
  }).prompt(
    `Scaffold a new ${state.codingLanguage} project at ${state.projectPath}. ` +
    `Follow the guide, run the smoke test, then index with GitNexus.`
  );

  log('SCAFFOLDER', 'Project ready ✓');
}
```

---

## `src/lsp.ts` — LSP code intelligence (optional)

When a language server is installed for the target project's coding language, agents can use it for precise code navigation — finding all references before a rename, checking types while writing, listing every caller of a function under review. When no server is available the function returns an empty array and agents work without LSP.

The module speaks plain JSON-RPC over stdio — no editor required.

```ts
// src/lsp.ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';
import type { Tool } from '@daedalus-ai-dev/ai-sdk';
import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import type { CodingLanguage } from './state.js';

// ─── Language server commands ─────────────────────────────────────────────────

const serverCommand: Record<CodingLanguage, { cmd: string; args: string[] }> = {
  typescript: { cmd: 'typescript-language-server', args: ['--stdio'] },
  go:         { cmd: 'gopls',                       args: [] },
  flutter:    { cmd: 'dart',                        args: ['language-server'] },
  python:     { cmd: 'pylsp',                       args: [] },
  rust:       { cmd: 'rust-analyzer',               args: [] },
};

// ─── Minimal JSON-RPC client over stdio ──────────────────────────────────────

class LspClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<number, (result: unknown) => void>();
  private nextId = 1;

  constructor(private projectPath: string, lang: CodingLanguage) {
    const { cmd, args } = serverCommand[lang];
    this.proc = spawn(cmd, args, { cwd: projectPath });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
    this.proc.stderr.on('data', () => { /* suppress language server logs */ });
  }

  private onData(raw: string): void {
    this.buffer += raw;
    const match = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
    if (!match) return;
    const len    = parseInt(match[1], 10);
    const start  = this.buffer.indexOf('\r\n\r\n') + 4;
    if (this.buffer.length < start + len) return;
    const body   = this.buffer.slice(start, start + len);
    this.buffer  = this.buffer.slice(start + len);
    const msg    = JSON.parse(body) as { id?: number; result?: unknown };
    if (msg.id !== undefined) this.pending.get(msg.id)?.(msg.result ?? null);
    this.pending.delete(msg.id!);
  }

  private send(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const id  = this.nextId++;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const envelope = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
      this.pending.set(id, resolve);
      this.proc.stdin.write(envelope);
    });
  }

  /** Handshake — must be called before any other request. */
  async initialize(): Promise<void> {
    await this.send('initialize', {
      processId: process.pid,
      rootUri: `file://${this.projectPath}`,
      capabilities: {
        textDocument: {
          references: { dynamicRegistration: false },
          hover:      { dynamicRegistration: false, contentFormat: ['plaintext'] },
          callHierarchy: { dynamicRegistration: false },
        },
        workspace: { symbol: { dynamicRegistration: false } },
      },
    });
    // notify the server the client is ready
    const notif = JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(notif)}\r\n\r\n${notif}`);
  }

  async workspaceSymbol(query: string) {
    return this.send('workspace/symbol', { query }) as Promise<LspSymbol[]>;
  }

  async documentSymbol(filePath: string) {
    return this.send('textDocument/documentSymbol', {
      textDocument: { uri: `file://${filePath}` },
    }) as Promise<LspSymbol[]>;
  }

  async hover(filePath: string, line: number, character: number) {
    return this.send('textDocument/hover', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    }) as Promise<{ contents: { value: string } } | null>;
  }

  async references(filePath: string, line: number, character: number) {
    return this.send('textDocument/references', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      context: { includeDeclaration: false },
    }) as Promise<LspLocation[]>;
  }

  async prepareCallHierarchy(filePath: string, line: number, character: number) {
    return this.send('textDocument/prepareCallHierarchy', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    }) as Promise<LspCallHierarchyItem[]>;
  }

  async incomingCalls(item: LspCallHierarchyItem) {
    return this.send('callHierarchy/incomingCalls', { item }) as Promise<LspIncomingCall[]>;
  }

  dispose(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// ─── LSP shape types (minimal) ────────────────────────────────────────────────

type LspSymbol          = { name: string; kind: number; location: LspLocation };
type LspLocation        = { uri: string; range: { start: { line: number; character: number } } };
type LspCallHierarchyItem = { name: string; uri: string; range: { start: { line: number; character: number } } };
type LspIncomingCall    = { from: LspCallHierarchyItem };

// ─── Helper: resolve a symbol name to its position ───────────────────────────

async function resolveSymbol(
  client: LspClient,
  projectPath: string,
  symbolName: string,
): Promise<{ filePath: string; line: number; character: number } | null> {
  const symbols = await client.workspaceSymbol(symbolName);
  const match   = symbols?.find((s) => s.name === symbolName);
  if (!match) return null;
  const filePath = match.location.uri.replace('file://', '');
  return { filePath, line: match.location.range.start.line, character: match.location.range.start.character };
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Create LSP-backed `defineTool()` instances for the target project.
 * Returns an empty array if the language server binary is not found,
 * so agents degrade gracefully without any code changes.
 *
 * @example
 * const lspTools = await createLspTools('/path/to/project', 'typescript');
 * // pass lspTools to agents in registry.ts
 */
export async function createLspTools(
  projectPath: string,
  lang: CodingLanguage,
): Promise<Tool[]> {
  const client = new LspClient(projectPath, lang);
  try {
    await client.initialize();
  } catch {
    console.warn(`⚠  LSP: no language server found for "${lang}" — skipping code intelligence tools`);
    client.dispose();
    return [];
  }

  const absPath = (p: string) => path.isAbsolute(p) ? p : path.join(projectPath, p);

  // ── Tool: search workspace symbols ─────────────────────────────────────────
  const lspWorkspaceSymbol = defineTool({
    name: 'lsp_workspace_symbol',
    description: 'Search for a symbol (function, class, type) by name across the entire project. Use this before planning tasks to check if something already exists.',
    schema: (s) => ({
      query: s.string().description('Symbol name or partial name to search for').required(),
    }),
    handle: async (input) => {
      const results = await client.workspaceSymbol(String(input.query));
      if (!results?.length) return `No symbols found matching "${input.query}".`;
      return results.slice(0, 20).map((s) =>
        `${s.name}  ${s.location.uri.replace('file://', '').replace(projectPath, '')}:${s.location.range.start.line + 1}`
      ).join('\n');
    },
  });

  // ── Tool: list symbols in a file ────────────────────────────────────────────
  const lspDocumentSymbols = defineTool({
    name: 'lsp_document_symbols',
    description: 'List all symbols (functions, classes, variables) defined in a file.',
    schema: (s) => ({
      filePath: s.string().description('Absolute or project-relative file path').required(),
    }),
    handle: async (input) => {
      const results = await client.documentSymbol(absPath(String(input.filePath)));
      if (!results?.length) return 'No symbols found.';
      return results.map((s) => `${s.name}  (line ${s.location.range.start.line + 1})`).join('\n');
    },
  });

  // ── Tool: hover — get type info ─────────────────────────────────────────────
  const lspHover = defineTool({
    name: 'lsp_hover',
    description: 'Get the type signature and documentation for a symbol at a specific position. Use while writing code to verify types.',
    schema: (s) => ({
      filePath:  s.string().description('Absolute or project-relative path').required(),
      line:      s.integer().description('1-based line number').required(),
      character: s.integer().description('1-based character offset').required(),
    }),
    handle: async (input) => {
      const result = await client.hover(
        absPath(String(input.filePath)),
        Number(input.line) - 1,      // LSP is 0-based
        Number(input.character) - 1,
      );
      return result?.contents?.value ?? 'No type information available.';
    },
  });

  // ── Tool: find all references ───────────────────────────────────────────────
  const lspFindReferences = defineTool({
    name: 'lsp_find_references',
    description: 'Find every usage of a symbol across the project. Run this before modifying or renaming a symbol to understand the blast radius.',
    schema: (s) => ({
      symbolName: s.string().description('Exact name of the symbol').required(),
    }),
    handle: async (input) => {
      const pos = await resolveSymbol(client, projectPath, String(input.symbolName));
      if (!pos) return `Symbol "${input.symbolName}" not found in workspace.`;
      const refs = await client.references(pos.filePath, pos.line, pos.character);
      if (!refs?.length) return 'No references found.';
      return refs.map((r) =>
        `${r.uri.replace('file://', '').replace(projectPath, '')}:${r.range.start.line + 1}`
      ).join('\n');
    },
  });

  // ── Tool: incoming call hierarchy ───────────────────────────────────────────
  const lspIncomingCalls = defineTool({
    name: 'lsp_incoming_calls',
    description: 'List every function that directly calls a given function. Use during code review to see the full call graph before commenting on a change.',
    schema: (s) => ({
      symbolName: s.string().description('Exact name of the function').required(),
    }),
    handle: async (input) => {
      const pos = await resolveSymbol(client, projectPath, String(input.symbolName));
      if (!pos) return `Function "${input.symbolName}" not found.`;
      const items = await client.prepareCallHierarchy(pos.filePath, pos.line, pos.character);
      if (!items?.length) return 'No call hierarchy available.';
      const calls = await client.incomingCalls(items[0]!);
      if (!calls?.length) return `No callers found for "${input.symbolName}".`;
      return calls.map((c) =>
        `${c.from.name}  ${c.from.uri.replace('file://', '').replace(projectPath, '')}:${c.from.range.start.line + 1}`
      ).join('\n');
    },
  });

  return [
    lspWorkspaceSymbol,
    lspDocumentSymbols,
    lspHover,
    lspFindReferences,
    lspIncomingCalls,
  ];
}
```

**Install the language server for your stack:**

```bash
# TypeScript
npm install -g typescript-language-server typescript

# Go
go install golang.org/x/tools/gopls@latest

# Flutter / Dart  (included with the Flutter SDK)
which dart   # already available if Flutter is installed

# Python
pip install python-lsp-server

# Rust
rustup component add rust-analyzer
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
  lspTools: Tool[] = [],          // empty array → agents work without LSP
): void {
  const fsTools        = fsMcp.tools;          // read_file, write_file, list_directory, …
  const gitnexusTools  = gitnexusMcp.tools;    // gitnexus_query, gitnexus_impact, gitnexus_context,
                                               // gitnexus_detect_changes, gitnexus_rename, …
  // LSP tools available when configured:
  //   lsp_workspace_symbol, lsp_document_symbols, lsp_hover,
  //   lsp_find_references, lsp_incoming_calls

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
  // gitnexus_query + gitnexus_context finds existing code before planning.
  // lsp_workspace_symbol lets it check if a function already exists by exact name.
  registerAgent('coding-machine', agent({
    provider: opus,
    instructions: codingMachinePrompt({ codeStyle: lang }),
    tools: [getTaskBoardTool, ...gitnexusTools, ...lspTools],
  }));

  // ── Fix Planner ──────────────────────────────────────────────────────────────
  registerAgent('fix-planner', agent({
    provider: opus,
    instructions: fixPlannerPrompt({ codeStyle: lang }),
    tools: [getTaskBoardTool, ...gitnexusTools],
  }));

  // ── Developer ────────────────────────────────────────────────────────────────
  // Long-running loop: summarizing() compresses completed task history.
  // gitnexus_impact before edits; gitnexus_detect_changes after.
  // lsp_hover checks type signatures while writing;
  // lsp_find_references verifies no call sites are missed before changing a signature.
  registerAgent('developer', agent({
    provider: opus,
    instructions: developerPrompt({ codeStyle: lang }),
    tools: [
      getNextTaskTool,
      getImplementedCodeTool,
      completeTaskTool,
      ...fsTools,         // write_file, read_file (no raw fs calls)
      ...gitnexusTools,   // gitnexus_impact, gitnexus_detect_changes
      ...lspTools,        // lsp_hover, lsp_find_references
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
  // gitnexus_context sees all callers of a changed symbol.
  // lsp_incoming_calls gives the precise call graph from the live language server —
  // useful when the GitNexus index is slightly stale.
  // lsp_document_symbols lists all symbols in a changed file for a quick overview.
  registerAgent('code-reviewer', agent({
    provider: opus,
    instructions: reviewerPrompt({ codeStyle: lang }),
    tools: [...fsTools, ...gitnexusTools, ...lspTools],
    contextManager: slidingWindow(20),
  }));

  // ── Refactorer ───────────────────────────────────────────────────────────────
  // gitnexus_rename for graph-aware multi-file rename.
  // lsp_find_references for a live cross-check that all usages are accounted for
  // before committing to a rename or signature change.
  registerAgent('refactorer', agent({
    provider: opus,
    instructions: refactorerPrompt({ codeStyle: lang }),
    tools: [...fsTools, ...gitnexusTools, ...lspTools],
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
import { getFilesystemMcp, getGitnexusMcp } from './mcp.js';
import { createLspTools } from './lsp.js';
import { scaffoldProject } from './scaffolder.js';
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

  // Connect filesystem MCP first — the scaffolder needs it before anything else
  const fsMcp = await getFilesystemMcp(projectPath);

  // ── Phase 0: scaffold the project ──────────────────────────────────────────
  // Creates the directory, initialises the language toolchain, installs the
  // BDD test runner, and runs `npx gitnexus analyze`. Must complete before
  // the GitNexus and LSP servers can connect (they need an indexed project).
  await scaffoldProject(fsMcp);

  // Now connect the remaining servers (GitNexus index is ready)
  const [gitnexusMcp, lspTools] = await Promise.all([
    getGitnexusMcp(projectPath),
    createLspTools(projectPath, state.codingLanguage),
  ]);

  if (lspTools.length > 0) {
    console.log(`✓ LSP connected (${lspTools.length} tools) for ${state.codingLanguage}`);
  }

  // Register all agents (prompts, context managers, tools all wired here)
  setupRegistry(fsMcp, gitnexusMcp, lspTools);

  log('WORKFLOW', `"${featureRequest}" [${state.codingLanguage}]`);

  // ── Orchestrator ──────────────────────────────────────────────────────────
  const orchestrator = agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are the workflow orchestrator for an AI-driven BDD development process.
Execute each phase in order. Use get_workflow_context between phases to stay oriented.

Target project: ${projectPath}
Coding language: ${state.codingLanguage}

All file paths passed to agents and tools must be absolute paths inside: ${projectPath}

Phases (phase 0 already complete — project is scaffolded and indexed):
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
| LSP (`createLspTools`) | `lsp.ts` | Live code intelligence from the language server: references, types, call hierarchy. Returns `[]` if not installed — agents degrade gracefully |
| `scaffoldProject` | `scaffolder.ts` | Phase 0: creates directory, initialises language toolchain, installs BDD runner, indexes GitNexus. Must complete before any other agent runs |
| `runCommandTool` (`defineTool`) | `tools/shell-tools.ts` | Scoped shell execution — only given to the scaffolder; no other agent has it |

### Tool usage per agent

| Agent | GitNexus | LSP | Purpose |
|---|---|---|---|
| Coding Machine | `gitnexus_query`, `gitnexus_context` | `lsp_workspace_symbol` | Check existing code + exact-name symbol lookup before planning |
| Fix Planner | `gitnexus_query` | — | Locate code related to failing steps |
| Developer | `gitnexus_impact`, `gitnexus_detect_changes` | `lsp_hover`, `lsp_find_references` | Blast radius before edit; type info while writing; all call sites before changing a signature |
| Code Reviewer | `gitnexus_context` | `lsp_incoming_calls`, `lsp_document_symbols` | Knowledge-graph callers + live call hierarchy; file symbol overview |
| Refactorer | `gitnexus_rename` | `lsp_find_references` | Live reference check before rename; graph-aware multi-file apply |

## Why this structure works

**`codingLanguage` as a first-class parameter.** Every agent system prompt receives the same language-specific style block via `promptTemplate`. Changing from TypeScript to Go is a one-line change at the entry point — every agent immediately writes idiomatic Go, including the test automation engineer, coding machine, and refactorer.

**GitNexus closes the feedback loop on existing code.** Without it, the coding machine plans tasks that duplicate existing functions. With it, `gitnexus_query` finds related code before planning, `gitnexus_impact` prevents silent breakage during implementation, and `gitnexus_rename` makes the refactorer's symbol changes safe across the entire call graph.

**MCP servers as shared infrastructure.** Both the filesystem and GitNexus servers are lazy singletons connected once and passed into `setupRegistry()`. Every agent that needs them receives the live tool list — no wrapper code, no duplication.

**GitNexus and LSP are complementary, not redundant.** GitNexus operates on a persistent knowledge graph — fast, context-rich, and great for impact analysis and architectural queries. LSP operates on the live source files — always up to date, precise to the character, and authoritative for type information. During a session where files change rapidly, LSP `lsp_find_references` is the ground truth; GitNexus `gitnexus_context` gives the broader picture of which execution flows are involved.

**The test runner is not an agent.** `cucumber-js` exit code is the ground truth. There's no benefit to asking an LLM whether tests passed. The fix loop (plan → implement → re-run) is triggered in code, which makes the control flow explicit and auditable.
