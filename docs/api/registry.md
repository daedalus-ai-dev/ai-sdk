# Agent Registry

A global registry for named, reusable agents. Register agents once and look them up by name anywhere in your application — particularly useful for orchestrator-worker patterns where an orchestrator needs to delegate to specialised sub-agents without wiring them together manually.

## Functions

### `registerAgent(name, config)`

```ts
function registerAgent(name: string, config: AgentConfig): void
```

Register an agent under a name. Calling again with the same name overwrites the previous registration.

### `getAgent(name)`

```ts
function getAgent(name: string): AgentRunner
```

Retrieve a registered agent and return a fresh `AgentRunner`. Throws if the name has not been registered.

### `agentTool(name, options?)`

```ts
function agentTool(name: string, options?: AgentToolOptions): Tool
```

Create a `Tool` that delegates to a registered agent. The tool accepts a `task` string, calls the agent's `.prompt()`, and returns the response text. This is the primary building block for orchestrator-worker patterns.

```ts
interface AgentToolOptions {
  description?: string; // override the description shown to the model
  toolName?: string;    // override the tool name (default: `delegate_to_<name>`)
}
```

### `hasAgent(name)` / `listAgents()` / `unregisterAgent(name)` / `clearAgents()`

Utility functions for inspecting and modifying the registry at runtime.

```ts
function hasAgent(name: string): boolean
function listAgents(): string[]
function unregisterAgent(name: string): void
function clearAgents(): void
```

## Examples

### Orchestrator-Workers

```ts
import {
  agent,
  configure,
  anthropic,
  registerAgent,
  agentTool,
  WebFetch,
} from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-sonnet-4-5') });

// 1. Register specialised workers
registerAgent('researcher', {
  instructions: 'You are a research specialist. Use the web fetch tool to find accurate information.',
  tools: [new WebFetch()],
});

registerAgent('writer', {
  instructions: 'You are a professional writer. Turn research notes into polished prose.',
});

// 2. Build the orchestrator using agentTool()
const orchestrator = agent({
  instructions: `You coordinate a research-and-writing pipeline.
First delegate research to the researcher, then pass the findings to the writer.`,
  tools: [
    agentTool('researcher'),
    agentTool('writer'),
  ],
});

// 3. Run it
const result = await orchestrator.prompt(
  'Write a short article about the James Webb Space Telescope.',
);
console.log(result.text);
```

### Custom tool name and description

```ts
const tool = agentTool('researcher', {
  toolName: 'research',
  description: 'Research a topic and return a summary.',
});
```

### Checking and listing agents

```ts
if (!hasAgent('researcher')) {
  registerAgent('researcher', { instructions: '...' });
}

console.log(listAgents()); // ['researcher', 'writer']
```

### Clearing in tests

```ts
import { clearAgents } from '@daedalus-ai-dev/ai-sdk';
import { beforeEach } from 'vitest';

beforeEach(() => clearAgents());
```
