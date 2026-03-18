import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// SSEClientTransport is the legacy transport for older MCP servers
// eslint-disable-next-line import/no-deprecated
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool } from '../tool.js';
import { RAW_INPUT_SCHEMA } from '../tool.js';
import type { JsonSchemaObject, PropertyBuilder, SchemaBuilder } from '../types.js';

// ─── Config types ─────────────────────────────────────────────────────────────

export interface McpStdioConfig {
  type: 'stdio';
  /** The executable to run. */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Extra environment variables for the spawned process. */
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  type: 'http';
  /** Full URL of the MCP server. */
  url: string;
  /**
   * Transport variant.
   * - `'streamable-http'` — MCP 2025-03-26 spec (default)
   * - `'sse'`            — legacy SSE-based servers
   */
  transport?: 'streamable-http' | 'sse';
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

// ─── McpConnection ────────────────────────────────────────────────────────────

/**
 * A live connection to an MCP server.
 * Exposes the discovered tools and a `disconnect()` method to clean up.
 */
export class McpConnection {
  constructor(
    private readonly client: Client,
    readonly tools: Tool[],
  ) {}

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}

// ─── no-op schema() placeholder ──────────────────────────────────────────────

function noopSchema(): Record<string, PropertyBuilder> {
  return {};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect to an MCP server and return its tools wrapped as SDK `Tool` objects.
 *
 * @example
 * // Stdio (e.g. GitNexus)
 * const { tools } = await connectMcp({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', 'gitnexus@latest', 'mcp'],
 * });
 *
 * const response = await agent({ instructions: '...', tools }).prompt('...');
 *
 * @example
 * // HTTP
 * const { tools, disconnect } = await connectMcp({
 *   type: 'http',
 *   url: 'https://my-mcp-server.example.com/mcp',
 * });
 */
export async function connectMcp(config: McpServerConfig): Promise<McpConnection> {
  const client = new Client({ name: 'daedalus-ai-sdk', version: '0.1.0' });

  if (config.type === 'stdio') {
    await client.connect(new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    }));
  } else {
    const url = new URL(config.url);
    const headers = config.headers;
    const variant = config.transport ?? 'streamable-http';

    if (variant === 'sse') {
      await client.connect(new SSEClientTransport(url, headers ? { requestInit: { headers } } : {}));
    } else {
      await client.connect(new StreamableHTTPClientTransport(url, headers ? { requestInit: { headers } } : {}));
    }
  }

  const { tools: mcpTools } = await client.listTools();

  const tools: Tool[] = mcpTools.map((mcpTool) => {
    const inputSchema = mcpTool.inputSchema as unknown as JsonSchemaObject;

    const tool: Tool & Record<symbol, unknown> = {
      [RAW_INPUT_SCHEMA]: inputSchema,

      name: () => mcpTool.name,
      description: () => mcpTool.description ?? '',
      schema: (_s: SchemaBuilder) => noopSchema(),

      async handle(input: Record<string, unknown>): Promise<string> {
        type ContentBlock = { type: string; text?: string };
        type CallResult = { content: ContentBlock[] };
        const result = await client.callTool({ name: mcpTool.name, arguments: input }) as unknown as CallResult;

        const content = result.content;

        return content
          .map((block) => {
            if (block.type === 'text') return block.text ?? '';
            // Serialize non-text content (images, resources) as JSON
            return JSON.stringify(block);
          })
          .join('\n');
      },
    };

    return tool;
  });

  return new McpConnection(client, tools);
}
