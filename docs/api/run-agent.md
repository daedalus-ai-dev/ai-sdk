# `runAgent(agentInstance, input, options?)`

Runs a class-based agent that implements `AgentInterface`.

## Signature

```ts
async function runAgent<T = unknown>(
  agentInstance: AgentInterface,
  input: string,
  options?: {
    provider?: AIProvider;
    history?: Message[];
  },
): Promise<AgentResponse<T>>
```

## `AgentInterface`

```ts
interface AgentInterface {
  /** System prompt — the agent's role and instructions. Required. */
  instructions(): string;

  /** Tools the agent can call. Optional. */
  tools?(): Tool[];

  /** Schema function for structured output. Optional property (not a method). */
  schema?: SchemaFn;

  /** Model identifier. Optional. */
  model?(): string;
}
```

## Example

```ts
import type { AgentInterface } from '@daedalus-ai-dev/ai-sdk';
import { runAgent, WebFetch } from '@daedalus-ai-dev/ai-sdk';

class ResearchAssistant implements AgentInterface {
  instructions() {
    return `You are a research assistant. Use the web to find accurate, up-to-date information.
    Always cite your sources by including URLs.`;
  }

  tools() {
    return [new WebFetch()];
  }

  model() {
    return 'anthropic/claude-3-5-sonnet';
  }
}

const response = await runAgent(
  new ResearchAssistant(),
  'What are the latest TypeScript 5.x features?',
);

console.log(response.text);
```

### With structured output

```ts
import type { AgentInterface, SchemaFn } from '@daedalus-ai-dev/ai-sdk';

class SentimentAnalyser implements AgentInterface {
  instructions() {
    return 'Analyse the sentiment of the provided text.';
  }

  schema: SchemaFn = (s) => ({
    sentiment:  s.enum(['positive', 'neutral', 'negative']).required(),
    score:      s.number().min(-1).max(1).description('-1 very negative, +1 very positive').required(),
    confidence: s.number().min(0).max(1).required(),
  });
}

type SentimentResult = {
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;
  confidence: number;
};

const response = await runAgent<SentimentResult>(
  new SentimentAnalyser(),
  'I absolutely love this product! Best purchase ever.',
);

console.log(response.structured.sentiment);  // 'positive'
console.log(response.structured.score);      // 0.95
```

### Passing a provider

```ts
import { openrouter } from '@daedalus-ai-dev/ai-sdk';

const response = await runAgent(new ResearchAssistant(), input, {
  provider: openrouter({ apiKey: process.env.OPENROUTER_API_KEY! }),
  history: previousMessages,
});
```

## Notes

- `runAgent()` is syntactic sugar over `new AgentRunner(config).prompt()` — it adapts `AgentInterface` to `AgentConfig`.
- Use the functional `agent()` API for one-off or inline agents; use `AgentInterface` + `runAgent()` for reusable, named agents that benefit from being defined as classes.
