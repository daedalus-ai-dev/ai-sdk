# Routing

**Routing** classifies input and dispatches it to the most appropriate specialist agent. A cheap classification model makes the routing decision; specialist agents handle the actual work.

```
Input → Classifier → Route A (Specialist A)
                   → Route B (Specialist B)
                   → Route C (Specialist C)
```

## When to use it

- Inputs vary significantly in type, topic, or required expertise
- Different inputs benefit from different instructions or models
- You want to use cheaper models for simple queries and powerful models for complex ones

## Basic example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';

async function handleSupportQuery(query: string): Promise<string> {
  // Step 1: Classify the query (cheap model, fast)
  const classification = await agent({
    instructions: 'Classify customer support queries. Return JSON only.',
    model: 'openai/gpt-4o-mini',
    schema: (s) => ({
      type:       s.enum(['general', 'refund', 'technical']).required(),
      complexity: s.enum(['simple', 'complex']).required(),
    }),
  }).prompt<{ type: string; complexity: string }>(`Classify: "${query}"`);

  const { type, complexity } = classification.structured;

  // Step 2: Route to the appropriate specialist
  const instructions = {
    refund:    'You are a customer service specialist handling refund requests. Be empathetic and follow the 30-day return policy.',
    technical: 'You are a technical support engineer. Ask clarifying questions and provide step-by-step solutions.',
    general:   'You are a friendly customer service agent. Be helpful and concise.',
  }[type] ?? 'You are a helpful customer service agent.';

  // Step 3: Use a more capable model for complex queries
  const model = complexity === 'complex'
    ? 'anthropic/claude-3-5-sonnet'
    : 'openai/gpt-4o-mini';

  const response = await agent({ instructions, model }).prompt(query);
  return response.text;
}
```

## Multi-dimensional routing

Route on multiple axes simultaneously:

```ts
type Classification = {
  language: 'en' | 'es' | 'de' | 'fr' | 'other';
  intent: 'question' | 'complaint' | 'feedback' | 'purchase';
  urgency: 'low' | 'medium' | 'high';
};

const classification = await agent({
  instructions: 'Classify incoming customer messages.',
  model: 'openai/gpt-4o-mini',
  schema: (s) => ({
    language: s.enum(['en', 'es', 'de', 'fr', 'other']).required(),
    intent:   s.enum(['question', 'complaint', 'feedback', 'purchase']).required(),
    urgency:  s.enum(['low', 'medium', 'high']).required(),
  }),
}).prompt<Classification>(`Classify: "${message}"`);

// Route to language-specific agent for non-English
if (classification.structured.language !== 'en') {
  return handleLocalisedQuery(message, classification.structured.language);
}

// Escalate high-urgency complaints immediately
if (classification.structured.intent === 'complaint' && classification.structured.urgency === 'high') {
  return escalateToHuman(message);
}

// Handle normally
return handleQuery(message, classification.structured.intent);
```

## Cost optimisation with routing

A powerful application of routing is using it to avoid paying for expensive models when simpler queries can be handled cheaply:

```ts
async function smartAgent(query: string): Promise<string> {
  // Assess complexity first
  const assessment = await agent({
    instructions: 'Assess whether a query requires deep reasoning or is straightforward.',
    model: 'openai/gpt-4o-mini',  // Always use cheap model for assessment
    schema: (s) => ({
      requiresDeepReasoning: s.boolean().required(),
      reason: s.string().required(),
    }),
  }).prompt<{ requiresDeepReasoning: boolean; reason: string }>(`Query: "${query}"`);

  const model = assessment.structured.requiresDeepReasoning
    ? 'anthropic/claude-3-5-sonnet'   // ~$3 / 1M tokens
    : 'openai/gpt-4o-mini';           // ~$0.15 / 1M tokens

  const response = await agent({
    instructions: 'You are a helpful assistant.',
    model,
  }).prompt(query);

  return response.text;
}
```

## Fallback chains

Handle unknown routes gracefully:

```ts
const handlers: Record<string, (q: string) => Promise<string>> = {
  billing: handleBilling,
  technical: handleTechnical,
  sales: handleSales,
};

const handler = handlers[type] ?? handleGeneral;
return handler(query);
```

## Tips

- **Keep classifiers narrow.** Ask only for the classification decision — not the answer.
- **Use structured output for routing.** It prevents the classifier from hallucinating category names.
- **Log routing decisions.** Tracking which routes are chosen reveals what users actually need.
- **Validate unknown routes.** Always have a default/fallback route.
