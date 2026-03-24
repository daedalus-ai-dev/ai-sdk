# Examples

Complete, real-world examples you can copy and run. Each example demonstrates one multi-agent pattern applied to a concrete problem.

| Example | Pattern | What it does |
|---|---|---|
| [Blog Post Pipeline](./blog-post-pipeline) | Prompt Chaining | Research → outline → draft → polish → SEO metadata |
| [Customer Support Router](./support-router) | Routing | Classifies messages by language, intent, and urgency; routes to specialists |
| [Competitive Analysis](./competitive-analysis) | Parallelization | Analyses multiple competitors simultaneously; synthesises into a brief |
| [Automated Code Review](./code-review-agent) | Orchestrator-Workers | Orchestrator reads a diff and delegates security, perf, and style reviews |
| [Cover Letter Generator](./cover-letter-generator) | Evaluator-Optimizer | Drafts a cover letter; evaluates against a rubric; rewrites until approved |
| [AI Development Workflow](./ai-development-workflow) | Chaining + Orchestration + Eval | Full BDD cycle: feature request → user story → three amigos → tests → implementation → review |
| [Markdown Research Pipeline](./markdown-research-pipeline) | Orchestrator-Workers | Agents and skills defined as markdown files; researcher + writer coordinated by an orchestrator |

## Running the examples

All examples use provider packages included in the SDK. Install the SDK and set your API key:

```bash
npm install @daedalus-ai-dev/ai-sdk
export ANTHROPIC_API_KEY=your_key_here
export OPENAI_API_KEY=your_key_here
```

Each example imports directly from the SDK:

```ts
import { agent, Pipeline, defineTool } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { openai } from '@daedalus-ai-dev/ai-sdk';
```

## Choosing a pattern

Not sure which pattern fits your use case? Start here:

- **Fixed sequence of steps** → [Prompt Chaining](./blog-post-pipeline)
- **Inputs vary in type or expertise needed** → [Routing](./support-router)
- **Independent sub-tasks that can run at the same time** → [Parallelization](./competitive-analysis)
- **Dynamic task breakdown, model decides what to do** → [Orchestrator-Workers](./code-review-agent)
- **Output needs to hit a quality bar** → [Evaluator-Optimizer](./cover-letter-generator)

See the [patterns overview](../patterns/overview) for a deeper comparison.
