import type { Tool } from '../tool.js';
import type { PropertyBuilder } from '../types.js';
import { StringPropertyBuilder } from '../types.js';

/**
 * Built-in tool that fetches a URL and returns its text content.
 */
export class WebFetch implements Tool {
  name(): string {
    return 'web_fetch';
  }

  description(): string {
    return 'Fetch the content of a URL and return it as text. Use this to retrieve web pages, APIs, or any HTTP resource.';
  }

  schema(): Record<string, PropertyBuilder> {
    return {
      url: new StringPropertyBuilder().description('The URL to fetch').required(),
    };
  }

  async handle(input: Record<string, unknown>): Promise<string> {
    const url = input.url;
    if (typeof url !== 'string') throw new Error('url must be a string');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'daedalus-ai-sdk/0.1' },
    });

    const text = await res.text();
    // Truncate to avoid overwhelming the context window
    return text.length > 10_000 ? `${text.slice(0, 10_000)}\n… [truncated]` : text;
  }
}
