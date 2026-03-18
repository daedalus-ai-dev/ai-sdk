# MCP Tools

The SDK can consume any [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server as a source of tools. Once connected, the server's tools are indistinguishable from hand-written `Tool` objects — you pass them to `agent()` the same way.

## What is MCP?

MCP is an open standard for connecting AI assistants to external tools, data, and services. Hundreds of MCP servers exist for databases, file systems, APIs, and developer tools (GitHub, Linear, Notion, etc.). Instead of writing a custom `Tool` wrapper for each one, `connectMcp()` bridges any MCP server into the SDK automatically.

## Connecting to a stdio server

Most local MCP servers (like [GitNexus](https://github.com/abhigyanpatwari/GitNexus)) run as a child process over stdin/stdout:

```ts
import { agent, connectMcp } from '@daedalus-ai-dev/ai-sdk';

const { tools, disconnect } = await connectMcp({
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'gitnexus@latest', 'mcp'],
});

const response = await agent({
  instructions: 'Analyse the codebase using the available tools.',
  tools,
}).prompt('What functions call agent()?');

console.log(response.text);

await disconnect(); // shut down the child process
```

## Connecting to an HTTP server

Remote MCP servers expose an HTTP endpoint. The SDK defaults to the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/docs/concepts/transports):

```ts
const { tools } = await connectMcp({
  type: 'http',
  url: 'https://my-mcp-server.example.com/mcp',
  headers: {
    Authorization: `Bearer ${process.env.MCP_API_KEY}`,
  },
});
```

For older servers that use the legacy SSE transport, set `transport: 'sse'`:

```ts
const { tools } = await connectMcp({
  type: 'http',
  url: 'https://legacy-server.example.com/sse',
  transport: 'sse',
});
```

## Using the tools

`connectMcp()` returns `Tool[]` — the same type used everywhere else in the SDK. Mix MCP tools with your own tools freely:

```ts
import { agent, connectMcp, WebFetch, defineTool } from '@daedalus-ai-dev/ai-sdk';

const { tools: gitnexusTools } = await connectMcp({
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'gitnexus@latest', 'mcp'],
});

const myTool = defineTool({ /* ... */ });

const response = await agent({
  instructions: 'Use all available tools to answer.',
  tools: [...gitnexusTools, new WebFetch(), myTool],
}).prompt('Find the agent() function and explain what calls it.');
```

## Lifecycle and disconnecting

`connectMcp()` opens a persistent connection. For stdio servers this means a child process is running. Call `disconnect()` when you are done:

```ts
const connection = await connectMcp({ type: 'stdio', command: 'npx', args: ['...'] });

try {
  await agent({ instructions: '...', tools: connection.tools }).prompt('...');
} finally {
  await connection.disconnect();
}
```

::: tip Long-running applications
In a server or CLI that runs continuously, you can share one `McpConnection` instance for the lifetime of the process. Calling `disconnect()` is optional if the process exits anyway — the child process will be cleaned up automatically.
:::

## `McpConnection`

`connectMcp()` returns an `McpConnection` instance:

```ts
class McpConnection {
  readonly tools: Tool[];
  disconnect(): Promise<void>;
}
```

| Member | Description |
|--------|-------------|
| `tools` | Array of `Tool` objects discovered from the server |
| `disconnect()` | Closes the transport and terminates any child process |
