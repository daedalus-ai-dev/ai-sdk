import { createXai } from '@ai-sdk/xai';
import type { AIProvider } from '../types.js';
import { vercelAI } from './vercel.js';

export interface XAIOptions {
  /** xAI API key. Defaults to XAI_API_KEY env var. */
  apiKey?: string;
}

/**
 * Create an xAI (Grok) provider for the given model.
 *
 * @example
 * import { xai } from '@daedalus-ai-dev/ai-sdk';
 * configure({ provider: xai('grok-3') });
 *
 * @example Custom API key
 * configure({ provider: xai('grok-3-mini', { apiKey: process.env.MY_KEY }) });
 */
export function xai(model: string, options?: XAIOptions): AIProvider {
  const provider = createXai({ apiKey: options?.apiKey });
  return vercelAI({ model: provider(model) });
}
