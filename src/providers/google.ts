import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { vercelAI } from './vercel.js';
import type { AIProvider } from '../types.js';

export interface GoogleOptions {
  /** Google AI API key. Defaults to GOOGLE_GENERATIVE_AI_API_KEY env var. */
  apiKey?: string;
}

/**
 * Create a Google AI (Gemini) provider for the given model.
 *
 * @example
 * import { google } from '@daedalus-ai-dev/ai-sdk';
 * configure({ provider: google('gemini-2.5-flash') });
 *
 * @example Custom API key
 * configure({ provider: google('gemini-2.5-pro', { apiKey: process.env.MY_KEY }) });
 */
export function google(model: string, options?: GoogleOptions): AIProvider {
  const provider = createGoogleGenerativeAI({ apiKey: options?.apiKey });
  return vercelAI({ model: provider(model) });
}
