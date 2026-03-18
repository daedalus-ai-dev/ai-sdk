# Orchestrator-Workers

An **orchestrator** agent dynamically breaks down a task and delegates sub-tasks to specialised **worker agents** via tools. The orchestrator decides what to do next based on intermediate results — it is not following a fixed script.

```
                    ┌─► Worker A (via tool)
Input → Orchestrator├─► Worker B (via tool) → Final Output
                    └─► Worker C (via tool)
```

## When to use it

- The task requires dynamic planning that cannot be predetermined
- Different subtasks need different expertise (writing, analysis, code generation)
- The orchestrator needs to react to intermediate results before deciding the next step

## Basic example

```ts
import { agent, defineTool } from '@daedalus-ai-dev/ai-sdk';

// Worker tools — each wraps a specialised agent
const analyseRequirementsTool = defineTool({
  name: 'analyse_requirements',
  description: 'Analyse a feature request and break it into technical requirements.',
  schema: (s) => ({
    featureRequest: s.string().required(),
  }),
  handle: async (input) => {
    const r = await agent({
      instructions: 'You are a senior product engineer skilled at translating feature requests into technical specs.',
    }).prompt(`Analyse and break down: ${input.featureRequest}`);
    return r.text;
  },
});

const writeCodeTool = defineTool({
  name: 'write_code',
  description: 'Write TypeScript code for a specific file or module.',
  schema: (s) => ({
    filePath: s.string().description('Path of the file to create').required(),
    purpose:  s.string().description('What this file should do').required(),
    context:  s.string().description('Relevant context or requirements').required(),
  }),
  handle: async (input) => {
    const r = await agent({
      instructions: 'You are an expert TypeScript developer. Write clean, idiomatic code with proper error handling.',
    }).prompt(`Create ${input.filePath} to ${input.purpose}.\n\nContext:\n${input.context}`);
    return r.text;
  },
});

const writeTestsTool = defineTool({
  name: 'write_tests',
  description: 'Write unit tests for a given piece of code.',
  schema: (s) => ({
    code:    s.string().description('The code to test').required(),
    context: s.string().description('What the code does').required(),
  }),
  handle: async (input) => {
    const r = await agent({
      instructions: 'You are a testing expert. Write comprehensive unit tests using Vitest.',
    }).prompt(`Write tests for:\n\n${input.code}\n\nContext: ${input.context}`);
    return r.text;
  },
});

// Orchestrator
const response = await agent({
  instructions: `You are a software architect. When given a feature request:
    1. Analyse the requirements first
    2. Write the implementation code
    3. Write tests for the implementation
    Use the available tools and work through each step systematically.`,
  tools: [analyseRequirementsTool, writeCodeTool, writeTestsTool],
  maxIterations: 20,
}).prompt('Implement a rate limiter middleware for an Express.js API.');

console.log(response.text);
```

## Stateful orchestration

Pass context through the orchestrator using tool results. The model maintains state in its conversation history:

```ts
const lookupOrderTool = defineTool({
  name: 'lookup_order',
  description: 'Look up an order by ID.',
  schema: (s) => ({ orderId: s.string().required() }),
  handle: async (input) => JSON.stringify(await db.orders.find(String(input.orderId))),
});

const issueRefundTool = defineTool({
  name: 'issue_refund',
  description: 'Issue a refund for an order. Only call after confirming the order exists and is eligible.',
  schema: (s) => ({
    orderId: s.string().required(),
    reason:  s.string().required(),
    amount:  s.number().min(0).required(),
  }),
  handle: async (input) => {
    await refundService.issue(String(input.orderId), Number(input.amount), String(input.reason));
    return `Refund of $${input.amount} issued for order ${input.orderId}.`;
  },
});

// The orchestrator naturally looks up the order before issuing the refund
const response = await agent({
  instructions: 'You are a customer service agent. Always verify orders before processing refunds.',
  tools: [lookupOrderTool, issueRefundTool],
}).prompt('Please refund order 12345 — the customer received a damaged item.');
```

## Hierarchical orchestration

Orchestrators can themselves be used as tools in a higher-level orchestrator:

```ts
const featureTeamTool = defineTool({
  name: 'feature_team',
  description: 'Delegate a complete feature implementation to the feature team orchestrator.',
  schema: (s) => ({ feature: s.string().required() }),
  handle: async (input) => {
    const r = await agent({
      instructions: 'You are a feature team orchestrator...',
      tools: [writeCodeTool, writeTestsTool, writeDocsTool],
    }).prompt(String(input.feature));
    return r.text;
  },
});

// CTO-level orchestrator
const response = await agent({
  instructions: 'You are a CTO. Break large initiatives into features and delegate to teams.',
  tools: [featureTeamTool, designReviewTool, securityAuditTool],
}).prompt('Build a complete OAuth2 authentication system.');
```

## Guarding against runaway loops

Always set `maxIterations` when the orchestrator might call many tools:

```ts
const response = await agent({
  instructions: '...',
  tools: [tool1, tool2, tool3],
  maxIterations: 15, // Prevent infinite loops
}).prompt('...');
```

If the agent exceeds `maxIterations`, it throws an error. Catch it to handle gracefully:

```ts
try {
  const response = await agent({ ..., maxIterations: 15 }).prompt('...');
  return response.text;
} catch (err) {
  if (err instanceof Error && err.message.includes('maxIterations')) {
    return 'The task took too many steps to complete. Please try a simpler request.';
  }
  throw err;
}
```

## Tips

- **Write clear tool descriptions.** The orchestrator's decisions depend entirely on tool names and descriptions.
- **Return rich context from worker tools.** The orchestrator needs enough information to make good next-step decisions.
- **Limit scope per tool.** Small, focused tools are easier for the orchestrator to use correctly than large, multipurpose ones.
- **Log tool call sequences.** `response.messages` shows exactly which tools were called and in what order — invaluable for debugging.
