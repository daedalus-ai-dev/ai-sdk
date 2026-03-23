import { agent } from './agent.js';
import { defineTool } from './tool.js';
import type { AgentConfig } from './agent.js';
import { InterruptError, isInterrupted } from './checkpoint.js';

// ─── Internal store ───────────────────────────────────────────────────────────

const store = new Map<string, AgentConfig>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a named agent in the global registry.
 *
 * @example
 * registerAgent('researcher', {
 *   instructions: 'You are a research specialist.',
 *   tools: [new WebFetch()],
 * });
 */
export function registerAgent(name: string, config: AgentConfig): void {
  store.set(name, config);
}

/**
 * Retrieve a registered agent by name and return a fresh AgentRunner.
 * Throws if the agent has not been registered.
 *
 * @example
 * const response = await getAgent('researcher').prompt('What is GraphQL?');
 */
export function getAgent(name: string): ReturnType<typeof agent> {
  const config = store.get(name);
  if (!config) {
    throw new Error(
      `Agent "${name}" not registered. Call registerAgent("${name}", config) first.`,
    );
  }
  return agent(config);
}

/**
 * Returns true if an agent with the given name has been registered.
 */
export function hasAgent(name: string): boolean {
  return store.has(name);
}

/**
 * List the names of all registered agents.
 */
export function listAgents(): string[] {
  return [...store.keys()];
}

/**
 * Remove a registered agent. Useful in tests or when reconfiguring at runtime.
 */
export function unregisterAgent(name: string): void {
  store.delete(name);
}

/**
 * Remove all registered agents.
 */
export function clearAgents(): void {
  store.clear();
}

// ─── agentTool ────────────────────────────────────────────────────────────────

export interface AgentToolOptions {
  /** Override the tool description shown to the orchestrating model. */
  description?: string;
  /** Override the tool name (default: `delegate_to_<name>`). */
  toolName?: string;
}

/**
 * Create a `Tool` that delegates to a registered agent.
 * Designed for use in orchestrator-worker patterns.
 *
 * @example
 * registerAgent('researcher', { instructions: '...', tools: [...] });
 * registerAgent('writer',     { instructions: '...', tools: [...] });
 *
 * const orchestrator = agent({
 *   instructions: 'Break the task into research and writing steps.',
 *   tools: [agentTool('researcher'), agentTool('writer')],
 * });
 */
export function agentTool(name: string, options?: AgentToolOptions) {
  return defineTool({
    name: options?.toolName ?? `delegate_to_${name}`,
    description: options?.description ?? `Delegate a task to the "${name}" agent.`,
    schema: (s) => ({
      task: s.string().description('The task or question to send to the agent').required(),
    }),
    async handle({ task }) {
      console.log(`\n[agent:${name}] starting`);
      const runner = getAgent(name);
      const response = await runner.prompt(task as string);
      if (isInterrupted(response)) {
        // Propagate the interrupt upward so the outer orchestrator also pauses.
        throw new InterruptError(response.question);
      }
      console.log(`[agent:${name}] done`);
      return response.text;
    },
  });
}
