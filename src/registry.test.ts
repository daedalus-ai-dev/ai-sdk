import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerAgent,
  getAgent,
  hasAgent,
  listAgents,
  unregisterAgent,
  clearAgents,
  agentTool,
} from './registry.js';

// ─── Mock agent() so tests don't need a real provider ─────────────────────────

const mockPrompt = vi.fn();

vi.mock('./agent.js', () => ({
  agent: vi.fn(() => ({ prompt: mockPrompt })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESEARCHER_CONFIG = {
  instructions: 'You are a research specialist.',
};

beforeEach(() => {
  clearAgents();
  vi.clearAllMocks();
});

// ─── registerAgent / getAgent ─────────────────────────────────────────────────

describe('registerAgent / getAgent', () => {
  it('returns a runner for a registered agent', () => {
    registerAgent('researcher', RESEARCHER_CONFIG);
    const runner = getAgent('researcher');
    expect(runner).toBeDefined();
    expect(typeof runner.prompt).toBe('function');
  });

  it('throws for an unknown agent', () => {
    expect(() => getAgent('unknown')).toThrow(
      'Agent "unknown" not registered',
    );
  });

  it('overwrites an existing registration', () => {
    registerAgent('bot', { instructions: 'v1' });
    registerAgent('bot', { instructions: 'v2' });
    expect(hasAgent('bot')).toBe(true);
    // getAgent returns a fresh runner — config was replaced silently
    expect(() => getAgent('bot')).not.toThrow();
  });
});

// ─── hasAgent ────────────────────────────────────────────────────────────────

describe('hasAgent', () => {
  it('returns false before registration', () => {
    expect(hasAgent('researcher')).toBe(false);
  });

  it('returns true after registration', () => {
    registerAgent('researcher', RESEARCHER_CONFIG);
    expect(hasAgent('researcher')).toBe(true);
  });
});

// ─── listAgents ───────────────────────────────────────────────────────────────

describe('listAgents', () => {
  it('returns empty array when nothing is registered', () => {
    expect(listAgents()).toEqual([]);
  });

  it('returns all registered names', () => {
    registerAgent('a', { instructions: '' });
    registerAgent('b', { instructions: '' });
    expect(listAgents()).toEqual(expect.arrayContaining(['a', 'b']));
    expect(listAgents()).toHaveLength(2);
  });
});

// ─── unregisterAgent ──────────────────────────────────────────────────────────

describe('unregisterAgent', () => {
  it('removes the agent from the registry', () => {
    registerAgent('researcher', RESEARCHER_CONFIG);
    unregisterAgent('researcher');
    expect(hasAgent('researcher')).toBe(false);
  });

  it('is a no-op for unknown agents', () => {
    expect(() => unregisterAgent('nobody')).not.toThrow();
  });
});

// ─── clearAgents ─────────────────────────────────────────────────────────────

describe('clearAgents', () => {
  it('removes all agents', () => {
    registerAgent('a', { instructions: '' });
    registerAgent('b', { instructions: '' });
    clearAgents();
    expect(listAgents()).toHaveLength(0);
  });
});

// ─── agentTool ────────────────────────────────────────────────────────────────

describe('agentTool', () => {
  it('has the correct default name and description', () => {
    registerAgent('researcher', RESEARCHER_CONFIG);
    const tool = agentTool('researcher');
    expect(tool.name()).toBe('delegate_to_researcher');
    expect(tool.description()).toContain('researcher');
  });

  it('accepts a custom tool name and description', () => {
    registerAgent('researcher', RESEARCHER_CONFIG);
    const tool = agentTool('researcher', {
      toolName: 'research',
      description: 'Look something up.',
    });
    expect(tool.name()).toBe('research');
    expect(tool.description()).toBe('Look something up.');
  });

  it('delegates handle() to the registered agent', async () => {
    mockPrompt.mockResolvedValue({ text: 'GraphQL is a query language.' });
    registerAgent('researcher', RESEARCHER_CONFIG);

    const tool = agentTool('researcher');
    const result = await tool.handle({ task: 'What is GraphQL?' });

    expect(mockPrompt).toHaveBeenCalledWith('What is GraphQL?');
    expect(result).toBe('GraphQL is a query language.');
  });

  it('throws when the referenced agent is not registered', async () => {
    const tool = agentTool('ghost');
    await expect(tool.handle({ task: 'hello' })).rejects.toThrow(
      'Agent "ghost" not registered',
    );
  });
});
