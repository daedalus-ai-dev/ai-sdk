# `WebFetch`

A built-in tool that fetches a URL and returns its text content. Allows agents to browse the web.

## Usage

```ts
import { agent, WebFetch } from '@daedalus-ai-dev/ai-sdk';

const response = await agent({
  instructions: 'You summarize web pages concisely.',
  tools: [new WebFetch()],
}).prompt('What is https://example.com about?');

console.log(response.text);
```

## Behaviour

- Sends a `GET` request with `User-Agent: daedalus-ai-sdk/0.1`
- Returns the raw response body as text (HTML, JSON, plain text, etc.)
- Truncates to **10,000 characters** with a `… [truncated]` suffix to avoid overwhelming the context window
- Throws on network errors (the SDK passes the error to the model)

## Tool definition

The tool registers itself as:

| Field | Value |
|-------|-------|
| Name | `web_fetch` |
| Description | `Fetch the content of a URL and return it as text. Use this to retrieve web pages, APIs, or any HTTP resource.` |
| Parameter | `url` (required string) |

## Limitations

- **No JavaScript rendering.** `WebFetch` fetches raw HTML — it does not execute JavaScript. Pages that require JS to display content will return empty or minimal HTML.
- **No authentication.** For authenticated endpoints, build a custom tool that adds the necessary headers or credentials.
- **Rate limits.** Calling `WebFetch` many times in parallel may trigger rate limiting on the target server.

## Custom web tool

For more control, define your own web fetcher:

```ts
import { defineTool } from '@daedalus-ai-dev/ai-sdk';

const authenticatedFetch = defineTool({
  name: 'fetch_api',
  description: 'Fetch data from our internal API.',
  schema: (s) => ({
    endpoint: s.string().description('API endpoint path, e.g. /users/123').required(),
  }),
  handle: async (input) => {
    const res = await fetch(`https://api.internal.com${input.endpoint}`, {
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.text();
  },
});
```
