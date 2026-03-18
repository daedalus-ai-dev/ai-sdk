import { createAnthropic } from '@ai-sdk/anthropic';
import { vercelAI } from './vercel.js';
import type { AIProvider } from '../types.js';

export interface AnthropicOptions {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

/**
 * Create an Anthropic provider for the given model.
 *
 * @example
 * import { anthropic } from '@daedalus-ai-dev/ai-sdk';
 * configure({ provider: anthropic('claude-sonnet-4-5') });
 *
 * @example Custom API key
 * configure({ provider: anthropic('claude-opus-4-6', { apiKey: process.env.MY_KEY }) });
 */
export function anthropic(model: string, options?: AnthropicOptions): AIProvider {
  const provider = createAnthropic({ apiKey: options?.apiKey });
  return vercelAI({ model: provider(model) });
}
