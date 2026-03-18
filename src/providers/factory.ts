import type { AIProvider } from '../types.js';
import { openai, type OpenAIOptions } from './openai.js';
import { anthropic, type AnthropicOptions } from './anthropic.js';
import { google, type GoogleOptions } from './google.js';
import { xai, type XAIOptions } from './xai.js';
import { openrouter, type OpenRouterOptions } from './openrouter.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BuiltInProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter';

export type CreateProviderOptions =
  | ({ provider: 'openai' }     & OpenAIOptions)
  | ({ provider: 'anthropic' }  & AnthropicOptions)
  | ({ provider: 'google' }     & GoogleOptions)
  | ({ provider: 'xai' }        & XAIOptions)
  | ({ provider: 'openrouter' } & Pick<OpenRouterOptions, 'apiKey'>);

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a built-in provider by name, model, and options.
 * Useful for configuration-driven or environment-variable-driven setups.
 *
 * @example Static config
 * const provider = createProvider({ provider: 'openai', model: 'gpt-4o' });
 *
 * @example From environment variables
 * const name   = process.env.AI_PROVIDER as BuiltInProvider;
 * const model  = process.env.AI_MODEL!;
 * const apiKey = process.env.AI_API_KEY;
 * configure({ provider: createProvider({ provider: name, model, apiKey }) });
 */
export function createProvider(options: CreateProviderOptions & { model: string }): AIProvider {
  const { provider, model, ...rest } = options;

  switch (provider) {
    case 'openai':
      return openai(model, rest as OpenAIOptions);
    case 'anthropic':
      return anthropic(model, rest as AnthropicOptions);
    case 'google':
      return google(model, rest as GoogleOptions);
    case 'xai':
      return xai(model, rest as XAIOptions);
    case 'openrouter': {
      const { apiKey } = rest as Pick<OpenRouterOptions, 'apiKey'>;
      const or = openrouter({ apiKey: apiKey ?? '' });
      // OpenRouter resolves model per-request; pin it here so the factory
      // behaves consistently with the Vercel AI SDK providers.
      return {
        chat: (req) => or.chat({ ...req, model }),
        stream: (req) => or.stream({ ...req, model }),
      };
    }
  }
}
