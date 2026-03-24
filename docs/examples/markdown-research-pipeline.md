# Example: Markdown Research Pipeline

**Pattern:** [Orchestrator-Workers](../patterns/orchestrator-workers) · [Markdown Agents & Partials](../guide/markdown-agents)

A research pipeline where agents and shared partials are defined as markdown files. An orchestrator delegates to a researcher and a writer, both loaded from disk at startup.

```
User query → Orchestrator → Researcher (web) → Writer → Final article
```

## File structure

```
project/
├── partials/
│   ├── tone.md
│   └── citation-style.md
├── agents/
│   ├── researcher.md
│   ├── writer.md
│   └── orchestrator.md
└── index.ts
```

## Partials

**`partials/tone.md`**

```markdown
---
name: tone
description: Response tone guidelines
---
Always respond in a clear, professional tone. Be direct and avoid unnecessary filler. Prefer active voice.
```

**`partials/citation-style.md`**

```markdown
---
name: citation-style
description: How to format source citations
---
When citing sources, include the format: [Source: <title> — <url>].
Cite at least one source per factual claim. If no source is available, say so explicitly.
```

## Agents

**`agents/researcher.md`**

```markdown
---
name: researcher
model: anthropic/claude-3-5-sonnet
tools: [web-fetch]
maxIterations: 8
---
You are a research specialist. Your job is to find accurate, current information
on the topic provided. Fetch multiple sources and synthesise the key findings.

{{partial:tone}}
{{partial:citation-style}}
```

**`agents/writer.md`**

```markdown
---
name: writer
model: anthropic/claude-3-5-sonnet
schema:
  title: string!
  article: string!
  wordCount: number!
---
You are a professional writer. Turn research notes into a polished article.
Write for a general audience. Output valid JSON matching the schema.

{{partial:tone}}
```

**`agents/orchestrator.md`**

```markdown
---
name: orchestrator
model: anthropic/claude-opus-4-6
tools: [delegate_to_researcher, delegate_to_writer]
maxIterations: 5
---
You coordinate a research-and-writing pipeline.

1. Delegate the research task to the researcher.
2. Pass the research findings to the writer with a clear brief.
3. Return the final article to the user.

Do not write content yourself — always delegate.
```

## Application code

```ts
import {
  configure,
  anthropic,
  loadPartialsFrom,
  loadAgentsFrom,
  getAgent,
  agentTool,
  WebFetch,
} from '@daedalus-ai-dev/ai-sdk';

configure({ provider: anthropic('claude-3-5-sonnet-20241022') });

// 1. Load shared partials first
await loadPartialsFrom('./partials');

// 2. Load worker agents with their tool dependencies
await loadAgentsFrom('./agents', {
  tools: {
    'web-fetch': new WebFetch(),
    // The orchestrator's tools are other agents — wire them after loading
    'delegate_to_researcher': agentTool('researcher'),
    'delegate_to_writer':     agentTool('writer'),
  },
});

// 3. Run the orchestrator
const result = await getAgent('orchestrator').prompt(
  'Write a 500-word article about the latest breakthroughs in fusion energy.',
);

console.log(result.text);
```

::: tip Agent tools in frontmatter
The orchestrator lists `delegate_to_researcher` and `delegate_to_writer` as tools. These are the default names that `agentTool()` generates (`delegate_to_<name>`). You can override the name with `agentTool('researcher', { toolName: 'research' })` and match the frontmatter accordingly.
:::

## What the structured writer output looks like

Because `writer.md` declares a `schema`, its response is parsed into a typed object:

```ts
type WriterOutput = {
  title: string;
  article: string;
  wordCount: number;
};

const writerResult = await getAgent('writer').prompt<WriterOutput>(
  'Write about fusion energy based on these notes: ...',
);

console.log(writerResult.structured.title);     // "Fusion Energy Reaches a Milestone"
console.log(writerResult.structured.wordCount); // 512
```

## Combining markdown and code-defined agents

You can mix both styles freely — they share the same registry:

```ts
import { registerAgent, agentTool } from '@daedalus-ai-dev/ai-sdk';

// Load most agents from markdown
await loadAgentsFrom('./agents', { tools: { 'web-fetch': new WebFetch() } });

// Register one agent in code (e.g. because it has a complex contextManager)
registerAgent('summariser', {
  instructions: 'Summarise the provided text in three bullet points.',
  contextManager: slidingWindow(10),
});

// Use them all the same way
const orchestrator = agent({
  instructions: 'Coordinate research, writing, and summarisation.',
  tools: [
    agentTool('researcher'),   // from markdown
    agentTool('writer'),       // from markdown
    agentTool('summariser'),   // from code
  ],
});
```
