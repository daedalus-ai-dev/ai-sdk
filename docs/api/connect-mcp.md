# `connectMcp(config)`

Connects to an MCP server and returns its tools as SDK-compatible `Tool` objects.

## Signature

```ts
async function connectMcp(config: McpServerConfig): Promise<McpConnection>
```

## Config types

### Stdio

```ts
interface McpStdioConfig {
  type: 'stdio';
  /** Executable to run (e.g. 'npx', 'node', '/usr/local/bin/my-server'). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Extra environment variables for the spawned process. */
  env?: Record<string, string>;
}
```

### HTTP

```ts
interface McpHttpConfig {
  type: 'http';
  /** Full URL of the MCP endpoint. */
  url: string;
  /**
   * Transport variant.
   * - 'streamable-http' — MCP 2025-03-26 spec (default)
   * - 'sse'            — legacy SSE-based servers
   */
  transport?: 'streamable-http' | 'sse';
  /** Extra headers sent with every request (e.g. Authorization). */
  headers?: Record<string, string>;
}
```

## `McpConnection`

```ts
class McpConnection {
  readonly tools: Tool[];
  disconnect(): Promise<void>;
}
```

| Member | Description |
|--------|-------------|
| `tools` | `Tool[]` — ready to pass to `agent()` |
| `disconnect()` | Closes the transport; terminates the child process for stdio servers |

## Examples

### GitNexus (stdio)

```ts
import { agent, connectMcp } from '@daedalus-ai-dev/ai-sdk';

const { tools, disconnect } = await connectMcp({
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'gitnexus@latest', 'mcp'],
});

const response = await agent({
  instructions: 'Use GitNexus to understand the codebase.',
  tools,
}).prompt('Show me the blast radius of changing the agent() function.');

await disconnect();
```

### Remote HTTP server

```ts
const { tools } = await connectMcp({
  type: 'http',
  url: 'https://api.example.com/mcp',
  headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` },
});
```

### Mixing MCP tools with custom tools

```ts
import { agent, connectMcp, defineTool, WebFetch } from '@daedalus-ai-dev/ai-sdk';

const { tools: mcpTools } = await connectMcp({ type: 'stdio', command: 'npx', args: ['...'] });

const myTool = defineTool({ name: 'my_tool', /* ... */ });

await agent({
  instructions: '...',
  tools: [...mcpTools, new WebFetch(), myTool],
}).prompt('...');
```

### With try/finally for guaranteed cleanup

```ts
const connection = await connectMcp({ type: 'stdio', command: 'npx', args: ['...'] });

try {
  const response = await agent({
    instructions: '...',
    tools: connection.tools,
  }).prompt('...');
  console.log(response.text);
} finally {
  await connection.disconnect();
}
```

## How it works

1. The SDK spawns a child process (stdio) or opens an HTTP connection
2. `listTools()` is called on the MCP server to discover available tools
3. Each tool is wrapped as a `Tool` object — its MCP JSON Schema is stored directly (bypassing the fluent schema builder) so no schema information is lost
4. When the agent calls a tool, `callTool()` is sent to the MCP server and the response content is returned as a string

Text content blocks are returned as-is; non-text blocks (images, resources) are JSON-serialized.
