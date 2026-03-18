/**
 * Stripe AI integration.
 *
 * Stripe offers two distinct AI integrations:
 *
 * ── 1. Stripe LLM Proxy (`@stripe/ai-sdk/provider`) ──────────────────────────
 * Routes model calls through Stripe's proxy, enabling unified billing across
 * multiple AI providers under a single Stripe account.
 *
 * ── 2. Token Metering (`@stripe/ai-sdk/meter`) ───────────────────────────────
 * Wraps any Vercel AI SDK LanguageModel to report token usage to Stripe Billing,
 * so you can charge your own customers for AI usage.
 *
 * ── Compatibility note ────────────────────────────────────────────────────────
 * `@stripe/ai-sdk@0.1.x` currently requires Vercel AI SDK v3–v5 as a peer
 * dependency. This SDK uses Vercel AI SDK v6, so `@stripe/ai-sdk` cannot be
 * installed alongside it yet. Track:
 * https://github.com/stripe/agent-toolkit/issues
 *
 * ── Workaround ────────────────────────────────────────────────────────────────
 * Until `@stripe/ai-sdk` is updated for v6, use the Stripe MCP server instead:
 *
 * ```ts
 * import { agent, connectMcp } from '@daedalus-ai-dev/ai-sdk';
 *
 * const { tools, disconnect } = await connectMcp({
 *   type: 'http',
 *   url: 'https://mcp.stripe.com',
 *   headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
 * });
 *
 * const response = await agent({
 *   instructions: 'You are a billing assistant.',
 *   tools,
 * }).prompt('Create a payment link for $29/month.');
 *
 * await disconnect();
 * ```
 *
 * ── Future API (once @stripe/ai-sdk supports v6) ─────────────────────────────
 * The planned public API will look like:
 *
 * ```ts
 * // Route through Stripe's LLM proxy:
 * import { stripe } from '@daedalus-ai-dev/ai-sdk';
 * configure({ provider: stripe('openai/gpt-4o', { apiKey: 'sk_...', customerId: 'cus_...' }) });
 *
 * // Wrap an existing model with token metering:
 * import { stripeMetered } from '@daedalus-ai-dev/ai-sdk';
 * import { openai } from '@ai-sdk/openai';
 * configure({ provider: stripeMetered(openai('gpt-4o'), { apiKey: 'sk_...', customerId: 'cus_...' }) });
 * ```
 */

export {};
