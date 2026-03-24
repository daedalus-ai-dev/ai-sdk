import { createOpenAI } from '@ai-sdk/openai';
import type { AIProvider } from '../types.js';
import { vercelAI } from './vercel.js';

export interface OpenAIOptions {
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Override the base URL (e.g. for Azure OpenAI or a local proxy). */
  baseUrl?: string;
}

/**
 * Create an OpenAI provider for the given model.
 *
 * @example
 * import { openai } from '@daedalus-ai-dev/ai-sdk';
 * configure({ provider: openai('gpt-4o') });
 *
 * @example Custom API key
 * configure({ provider: openai('gpt-4o', { apiKey: process.env.MY_KEY }) });
 */
export function openai(model: string, options?: OpenAIOptions): AIProvider {
  const provider = createOpenAI({
    apiKey: options?.apiKey,
    baseURL: options?.baseUrl,
  });
  return vercelAI({ model: provider(model) });
}
