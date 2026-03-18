// ─── Core ─────────────────────────────────────────────────────────────────────
export { agent, runAgent, configure } from './agent.js';
export type { AgentInterface, AgentConfig } from './agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  Role,
  Message,
  MessageContent,
  TextContent,
  ImageContent,
  ImageBase64Content,
  ToolUseContent,
  ToolResultContent,
  Usage,
  StopReason,
  ToolDefinition,
  JsonSchemaObject,
  JsonSchemaProperty,
  JsonSchemaString,
  JsonSchemaNumber,
  JsonSchemaInteger,
  JsonSchemaBoolean,
  JsonSchemaArray,
  JsonSchemaEnum,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  AIProvider,
  AgentResponse,
  StreamedAgentResponse,
  SchemaFn,
  SchemaBuilder,
} from './types.js';

export {
  PropertyBuilder,
  StringPropertyBuilder,
  NumberPropertyBuilder,
  IntegerPropertyBuilder,
  BooleanPropertyBuilder,
  ArrayPropertyBuilder,
  EnumPropertyBuilder,
} from './types.js';

// ─── Schema builder ───────────────────────────────────────────────────────────
export { schema, buildSchema } from './schema.js';

// ─── Tool ─────────────────────────────────────────────────────────────────────
export type { Tool } from './tool.js';
export { toolToDefinition, defineTool } from './tool.js';

// ─── Pipeline ─────────────────────────────────────────────────────────────────
export { Pipeline } from './pipeline.js';
export type { PipelineStep } from './pipeline.js';

// ─── Providers ────────────────────────────────────────────────────────────────
export { OpenRouterProvider, openrouter } from './providers/openrouter.js';
export type { OpenRouterOptions } from './providers/openrouter.js';

export { vercelAI } from './providers/vercel.js';
export type { VercelAIOptions } from './providers/vercel.js';

// ─── Built-in tools ───────────────────────────────────────────────────────────
export { WebFetch } from './tools/web-fetch.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────
export { connectMcp, McpConnection } from './mcp/index.js';
export type { McpServerConfig, McpStdioConfig, McpHttpConfig } from './mcp/index.js';
