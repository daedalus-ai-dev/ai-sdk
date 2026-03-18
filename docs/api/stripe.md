# Stripe AI Integration

Stripe offers two distinct AI integrations:

## 1. Stripe MCP Server (recommended)

The easiest way to give agents access to Stripe is via the official [Stripe MCP server](https://docs.stripe.com/agents/mcp-server). No additional npm packages required.

```ts
import { agent, connectMcp } from '@daedalus-ai-dev/ai-sdk';

const { tools, disconnect } = await connectMcp({
  type: 'http',
  url: 'https://mcp.stripe.com',
  headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
});

try {
  const response = await agent({
    instructions: 'You are a billing assistant.',
    tools,
  }).prompt('Create a payment link for a $29/month subscription.');

  console.log(response.text);
} finally {
  await disconnect();
}
```

The MCP server exposes tools for products, prices, payment links, customers, subscriptions, and more.

## 2. `@stripe/ai-sdk` (pending v6 support)

`@stripe/ai-sdk` provides two additional integrations:

### Token metering

Wraps any Vercel AI SDK `LanguageModel` to report token usage to Stripe Billing — enabling usage-based billing of your own customers.

### Stripe LLM Proxy

Routes model calls through Stripe's proxy for unified billing across providers.

::: warning Compatibility
`@stripe/ai-sdk@0.1.x` requires Vercel AI SDK **v3–v5** as a peer dependency. This SDK uses **v6**, so `@stripe/ai-sdk` cannot be installed alongside it yet.

Track the upstream issue: [github.com/stripe/agent-toolkit](https://github.com/stripe/agent-toolkit)
:::

Once `@stripe/ai-sdk` is updated for v6, the planned API will be:

```ts
// Route through Stripe's LLM proxy
import { stripe } from '@daedalus-ai-dev/ai-sdk';

configure({
  provider: stripe('openai/gpt-4o', {
    apiKey: process.env.STRIPE_SECRET_KEY,
    customerId: 'cus_xxxxx',
  }),
});
```

```ts
// Meter an existing provider
import { stripeMetered } from '@daedalus-ai-dev/ai-sdk';
import { openai } from '@ai-sdk/openai';

configure({
  provider: stripeMetered(openai('gpt-4o'), {
    apiKey: process.env.STRIPE_SECRET_KEY,
    customerId: 'cus_xxxxx',
  }),
});
```
