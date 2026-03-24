// ─── Core ─────────────────────────────────────────────────────────────────────
export { agent, runAgent, configure } from './agent.js';
export type { AgentInterface, AgentConfig } from './agent.js';

// ─── Checkpointing ────────────────────────────────────────────────────────────
export { InterruptError, isInterrupted, assertComplete } from './checkpoint.js';

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
  InterruptedResponse,
  Checkpoint,
  StreamedAgentResponse,
  SchemaFn,
  SchemaBuilder,
  ZodLike,
  SchemaInput,
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
export { isZodSchema, isRawJsonSchema } from './zod.js';

// ─── Context Window Management ────────────────────────────────────────────────
export type { ContextManager } from './context-manager.js';
export type { SummarizingOptions } from './context-manager.js';
export { slidingWindow, tokenBudget, summarizing } from './context-manager.js';

// ─── Prompt Templates ─────────────────────────────────────────────────────────
export { promptTemplate, createPrompt } from './prompt-template.js';

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

export { openai } from './providers/openai.js';
export type { OpenAIOptions } from './providers/openai.js';

export { anthropic } from './providers/anthropic.js';
export type { AnthropicOptions } from './providers/anthropic.js';

export { google } from './providers/google.js';
export type { GoogleOptions } from './providers/google.js';

export { xai } from './providers/xai.js';
export type { XAIOptions } from './providers/xai.js';

export { createProvider } from './providers/factory.js';
export type { BuiltInProvider, CreateProviderOptions } from './providers/factory.js';

// ─── Built-in tools ───────────────────────────────────────────────────────────
export { WebFetch } from './tools/web-fetch.js';

// ─── Registry ─────────────────────────────────────────────────────────────────
export {
  registerAgent,
  getAgent,
  hasAgent,
  listAgents,
  unregisterAgent,
  clearAgents,
  agentTool,
} from './registry.js';
export type { AgentToolOptions } from './registry.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────
export { connectMcp, McpConnection } from './mcp/index.js';
export type { McpServerConfig, McpStdioConfig, McpHttpConfig } from './mcp/index.js';

// ─── Markdown loaders ─────────────────────────────────────────────────────────
export { parseAgent, loadAgent, loadAgentsFrom, yamlSchemaToJsonSchema } from './loader.js';
export type { LoadAgentOptions } from './loader.js';

export {
  parseSkill,
  loadSkill,
  loadSkillsFrom,
  registerSkill,
  getSkill,
  hasSkill,
  listSkills,
  clearSkills,
} from './skill.js';
export type { Skill } from './skill.js';
