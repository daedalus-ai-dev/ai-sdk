# Example: Competitive Analysis

**Pattern:** [Parallelization](../patterns/parallelization)

Given a list of competitors, this example analyses each one simultaneously across four dimensions — pricing, features, positioning, and weaknesses — then synthesises everything into a concise competitive brief.

```
Competitors ──► Pricing analyst    ─┐
             ──► Feature analyst   ─┤
             ──► Positioning analyst─┤─► Synthesis → Brief
             ──► Weakness analyst  ─┘
(all run in parallel per competitor)
```

## Full example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { openai } from '@daedalus-ai-dev/ai-sdk';

type Competitor = {
  name: string;
  website: string;
  description: string;
};

type CompetitorAnalysis = {
  name: string;
  pricing: string;
  features: string;
  positioning: string;
  weaknesses: string;
};

type Brief = {
  summary: string;
  opportunities: string[];
  threats: string[];
  recommendation: string;
};

// ─── Analyse one competitor across four dimensions in parallel ────────────────

async function analyseCompetitor(competitor: Competitor): Promise<CompetitorAnalysis> {
  const context = `
Company: ${competitor.name}
Website: ${competitor.website}
Description: ${competitor.description}
  `.trim();

  const [pricing, features, positioning, weaknesses] = await Promise.all([
    agent({
      provider: openai('gpt-4o-mini'),
      instructions: 'You are a pricing analyst. Be specific about tiers, price points, and what is included at each level.',
    }).prompt(`Analyse the pricing strategy for:\n\n${context}`),

    agent({
      provider: openai('gpt-4o-mini'),
      instructions: 'You are a product analyst. Focus on differentiating features, integrations, and technical capabilities.',
    }).prompt(`Analyse the key features and capabilities of:\n\n${context}`),

    agent({
      provider: openai('gpt-4o-mini'),
      instructions: 'You are a brand strategist. Identify target segments, messaging tone, and positioning claims.',
    }).prompt(`Analyse the market positioning of:\n\n${context}`),

    agent({
      provider: openai('gpt-4o-mini'),
      instructions: 'You are a competitive intelligence analyst. Surface gaps, complaints, limitations, and areas where customers switch away.',
    }).prompt(`Identify the weaknesses and vulnerabilities of:\n\n${context}`),
  ]);

  return {
    name: competitor.name,
    pricing: pricing.text,
    features: features.text,
    positioning: positioning.text,
    weaknesses: weaknesses.text,
  };
}

// ─── Run all competitor analyses in parallel ──────────────────────────────────

async function runCompetitiveAnalysis(
  ourProduct: string,
  competitors: Competitor[]
): Promise<Brief> {
  console.log(`Analysing ${competitors.length} competitors in parallel...`);

  const analyses = await Promise.all(
    competitors.map((c) => analyseCompetitor(c))
  );

  console.log('✓ All competitor analyses complete. Synthesising...');

  // Build the combined context for synthesis
  const competitorSummaries = analyses.map((a) => `
## ${a.name}

**Pricing:** ${a.pricing}

**Key features:** ${a.features}

**Positioning:** ${a.positioning}

**Weaknesses:** ${a.weaknesses}
  `.trim()).join('\n\n---\n\n');

  // Synthesise into an actionable brief
  const brief = await agent({
    provider: anthropic('claude-opus-4-6'),
    instructions: `You are a Head of Product writing an internal competitive brief.
Be direct and opinionated. Surface actionable insights, not summaries.`,
    schema: (s) => ({
      summary: s.string()
        .description('2–3 sentence executive summary of the competitive landscape')
        .required(),
      opportunities: s.array()
        .items(s.string().toSchema())
        .description('3–5 concrete opportunities our product can exploit')
        .required(),
      threats: s.array()
        .items(s.string().toSchema())
        .description('3–5 specific threats or moves to watch')
        .required(),
      recommendation: s.string()
        .description('One clear strategic recommendation')
        .required(),
    }),
  }).prompt<Brief>(`
Our product: ${ourProduct}

Competitor research:

${competitorSummaries}

Write a competitive brief.
  `);

  return brief.structured;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

const brief = await runCompetitiveAnalysis(
  'Daedalus AI SDK — TypeScript SDK for building multi-agent AI workflows',
  [
    {
      name: 'LangChain',
      website: 'https://langchain.com',
      description: 'Python and JavaScript framework for LLM-powered applications. Focus on chains, agents, and retrieval-augmented generation.',
    },
    {
      name: 'Vercel AI SDK',
      website: 'https://sdk.vercel.ai',
      description: 'TypeScript SDK for building AI-powered web applications. Tight Next.js integration, streaming-first.',
    },
    {
      name: 'LlamaIndex',
      website: 'https://llamaindex.ai',
      description: 'Data framework for LLM applications. Focus on ingesting, indexing, and querying large document sets.',
    },
  ]
);

console.log('\n══ Competitive Brief ══════════════════════════\n');
console.log(brief.summary);
console.log('\nOpportunities:');
brief.opportunities.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
console.log('\nThreats:');
brief.threats.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log('\nRecommendation:');
console.log(`  ${brief.recommendation}`);
```

## Why this structure works

- **Four parallel analysts per competitor.** Each dimension is handled independently — no cross-contamination between pricing and positioning analysis.
- **All competitors run at the same time.** Three competitors × four analysts = 12 parallel LLM calls instead of 12 sequential ones.
- **Cheap models for research, powerful model for synthesis.** `gpt-4o-mini` handles the research pass at low cost; `claude-opus-4-6` synthesises the nuanced strategic output.
- **Structured synthesis output.** The brief is returned as typed data, not prose — easy to slot into a dashboard, Slack message, or report template.

## Controlling concurrency

For large competitor lists, avoid hitting rate limits with batching:

```ts
import pLimit from 'p-limit';

const limit = pLimit(5); // max 5 competitors at a time

const analyses = await Promise.all(
  competitors.map((c) => limit(() => analyseCompetitor(c)))
);
```

## Collecting total cost

```ts
// Each analyseCompetitor call runs 4 agents — track total usage
let totalInput = 0;
let totalOutput = 0;

// Modify analyseCompetitor to return usage alongside analysis,
// then sum across all competitors:
analyses.forEach(({ usage }) => {
  totalInput += usage.inputTokens;
  totalOutput += usage.outputTokens;
});
console.log(`Total tokens: ${totalInput} in / ${totalOutput} out`);
```
