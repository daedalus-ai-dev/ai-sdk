import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectMcp } from './client.js';

// ─── Mock @modelcontextprotocol/sdk ───────────────────────────────────────────

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({ type: 'stdio-transport' })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({ type: 'http-transport' })),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({ type: 'sse-transport' })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CALCULATOR_TOOL = {
  name: 'calculator',
  description: 'Adds two numbers',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'integer' },
      b: { type: 'integer' },
    },
    required: ['a', 'b'],
  },
};

const NO_DESCRIPTION_TOOL = {
  name: 'silent_tool',
  inputSchema: { type: 'object', properties: {} },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('connectMcp() — stdio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({ tools: [CALCULATOR_TOOL] });
  });

  it('connects via stdio and returns wrapped tools', async () => {
    const { tools } = await connectMcp({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server@latest', 'mcp'],
    });

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(tools).toHaveLength(1);
  });

  it('wraps tool name and description', async () => {
    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const [tool] = tools;

    expect(tool!.name()).toBe('calculator');
    expect(tool!.description()).toBe('Adds two numbers');
  });

  it('uses empty string when description is missing', async () => {
    mockListTools.mockResolvedValue({ tools: [NO_DESCRIPTION_TOOL] });
    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });

    expect(tools[0]!.description()).toBe('');
  });

  it('passes the raw MCP inputSchema through to toolToDefinition', async () => {
    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const tool = tools[0]!;

    // The RAW_INPUT_SCHEMA symbol should be present
    const { RAW_INPUT_SCHEMA } = await import('../tool.js');
    expect((tool as unknown as Record<symbol, unknown>)[RAW_INPUT_SCHEMA]).toEqual(CALCULATOR_TOOL.inputSchema);
  });

  it('calls the MCP server when handle() is invoked', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '7' }],
    });

    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const result = await tools[0]!.handle({ a: 3, b: 4 });

    expect(mockCallTool).toHaveBeenCalledWith({ name: 'calculator', arguments: { a: 3, b: 4 } });
    expect(result).toBe('7');
  });

  it('concatenates multiple text content blocks', async () => {
    mockCallTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ],
    });

    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const result = await tools[0]!.handle({});

    expect(result).toBe('line 1\nline 2');
  });

  it('serializes non-text content blocks as JSON', async () => {
    const imageBlock = { type: 'image', data: 'base64data', mimeType: 'image/png' };
    mockCallTool.mockResolvedValue({ content: [imageBlock] });

    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const result = await tools[0]!.handle({});

    expect(result).toBe(JSON.stringify(imageBlock));
  });
});

describe('connectMcp() — HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({ tools: [CALCULATOR_TOOL] });
  });

  it('connects via streamable HTTP by default', async () => {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    await connectMcp({ type: 'http', url: 'https://example.com/mcp' });

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('https://example.com/mcp'),
      {},
    );
  });

  it('connects via SSE when transport is "sse"', async () => {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');

    await connectMcp({ type: 'http', url: 'https://example.com/sse', transport: 'sse' });

    expect(SSEClientTransport).toHaveBeenCalledWith(
      new URL('https://example.com/sse'),
      {},
    );
  });

  it('passes custom headers to the transport', async () => {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    await connectMcp({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('https://example.com/mcp'),
      { requestInit: { headers: { Authorization: 'Bearer token' } } },
    );
  });
});

describe('McpConnection.disconnect()', () => {
  it('closes the underlying MCP client', async () => {
    mockListTools.mockResolvedValue({ tools: [] });

    const connection = await connectMcp({ type: 'stdio', command: 'npx' });
    await connection.disconnect();

    expect(mockClose).toHaveBeenCalledOnce();
  });
});

describe('toolToDefinition integration', () => {
  it('uses raw MCP schema instead of rebuilding via schema builder', async () => {
    mockListTools.mockResolvedValue({ tools: [CALCULATOR_TOOL] });

    const { tools } = await connectMcp({ type: 'stdio', command: 'npx' });
    const { toolToDefinition } = await import('../tool.js');

    const definition = toolToDefinition(tools[0]!);

    expect(definition.name).toBe('calculator');
    expect(definition.description).toBe('Adds two numbers');
    expect(definition.inputSchema).toEqual(CALCULATOR_TOOL.inputSchema);
  });
});
