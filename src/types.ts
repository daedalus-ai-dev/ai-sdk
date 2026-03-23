// ─── Message types ────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  url: string;
  mimeType?: string;
}

export interface ImageBase64Content {
  type: 'image_base64';
  data: string;
  mimeType: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ImageBase64Content
  | ToolUseContent
  | ToolResultContent;

export interface Message {
  role: Role;
  content: string | MessageContent[];
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// ─── Stop reasons ─────────────────────────────────────────────────────────────

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

// ─── Tool definition (sent to provider) ─────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

// ─── JSON Schema ──────────────────────────────────────────────────────────────

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JsonSchemaProperty =
  | JsonSchemaString
  | JsonSchemaNumber
  | JsonSchemaInteger
  | JsonSchemaBoolean
  | JsonSchemaArray
  | JsonSchemaObject
  | JsonSchemaEnum;

export interface JsonSchemaString {
  type: 'string';
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
}

export interface JsonSchemaNumber {
  type: 'number';
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface JsonSchemaInteger {
  type: 'integer';
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface JsonSchemaBoolean {
  type: 'boolean';
  description?: string;
}

export interface JsonSchemaArray {
  type: 'array';
  description?: string;
  items?: JsonSchemaProperty;
}

export interface JsonSchemaEnum {
  type: 'string';
  enum: string[];
  description?: string;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface ChatRequest {
  model: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  responseFormat?: { type: 'json_schema'; schema: JsonSchemaObject; name: string };
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  id: string;
  content: MessageContent[];
  stopReason: StopReason;
  usage: Usage;
}

export interface StreamChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end';
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInputDelta?: string;
  stopReason?: StopReason;
  usage?: Usage;
}

export interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

/**
 * Serialisable snapshot of agent execution state.
 * All fields are plain JSON — safe to store in KV, a database, or pass over HTTP.
 */
export interface Checkpoint {
  /** Full conversation history at the time of the snapshot. */
  messages: Message[];
  /** Number of provider calls consumed so far — checked against maxIterations on resume. */
  iterations: number;
  /** Accumulated token usage across all iterations. */
  usage: Usage;
  /**
   * Set when the agent was paused by an InterruptError.
   * Required by `AgentRunner.resume()` to inject the user's answer as a tool result.
   */
  pendingToolUseId?: string;
}

// ─── Agent response ───────────────────────────────────────────────────────────

export interface AgentResponse<T = unknown> {
  text: string;
  structured: T;
  usage: Usage;
  messages: Message[];
  /**
   * Serialisable snapshot of execution state at the end of the run.
   * Store this and pass it to `AgentRunner.resume()` to continue later.
   */
  checkpoint: Checkpoint;
}

export interface StreamedAgentResponse {
  text: string;
  usage: Usage;
  messages: Message[];
}

/**
 * Returned by `AgentRunner.prompt()` when a tool throws an `InterruptError`.
 * Save `checkpoint` (it is fully JSON-serialisable) and call
 * `AgentRunner.resume(checkpoint, answer)` when the user replies.
 */
export interface InterruptedResponse {
  interrupted: true;
  /** The question the agent wants answered before it can continue. */
  question: string;
  /** Save this and pass to `AgentRunner.resume(checkpoint, answer)`. */
  checkpoint: Checkpoint & { pendingToolUseId: string };
}

// ─── Schema builder ───────────────────────────────────────────────────────────

export type SchemaFn = (schema: SchemaBuilder) => Record<string, PropertyBuilder>;

/**
 * Duck-typed interface matching any Zod schema object.
 * Avoids a hard dependency on the `zod` package.
 */
export interface ZodLike {
  _def: unknown;
  parse(data: unknown): unknown;
  safeParse(data: unknown): { success: boolean; data?: unknown; error?: unknown };
}

/** Accepted wherever a schema can be provided — fluent builder or a Zod schema. */
export type SchemaInput = SchemaFn | ZodLike;

// Property builder — fluent API that emits a JsonSchemaProperty
export abstract class PropertyBuilder {
  _required = false;
  protected _description?: string;

  required(): this {
    this._required = true;
    return this;
  }

  description(text: string): this {
    this._description = text;
    return this;
  }

  abstract toSchema(): JsonSchemaProperty;
}

export class StringPropertyBuilder extends PropertyBuilder {
  private _minLength?: number;
  private _maxLength?: number;
  private _pattern?: string;

  minLength(n: number): this { this._minLength = n; return this; }
  maxLength(n: number): this { this._maxLength = n; return this; }
  pattern(regex: string): this { this._pattern = regex; return this; }

  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaString = { type: 'string' };
    if (this._description) s.description = this._description;
    if (this._minLength !== undefined) s.minLength = this._minLength;
    if (this._maxLength !== undefined) s.maxLength = this._maxLength;
    if (this._pattern) s.pattern = this._pattern;
    return s;
  }
}

export class NumberPropertyBuilder extends PropertyBuilder {
  private _min?: number;
  private _max?: number;

  min(n: number): this { this._min = n; return this; }
  max(n: number): this { this._max = n; return this; }

  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaNumber = { type: 'number' };
    if (this._description) s.description = this._description;
    if (this._min !== undefined) s.minimum = this._min;
    if (this._max !== undefined) s.maximum = this._max;
    return s;
  }
}

export class IntegerPropertyBuilder extends PropertyBuilder {
  private _min?: number;
  private _max?: number;

  min(n: number): this { this._min = n; return this; }
  max(n: number): this { this._max = n; return this; }

  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaInteger = { type: 'integer' };
    if (this._description) s.description = this._description;
    if (this._min !== undefined) s.minimum = this._min;
    if (this._max !== undefined) s.maximum = this._max;
    return s;
  }
}

export class BooleanPropertyBuilder extends PropertyBuilder {
  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaBoolean = { type: 'boolean' };
    if (this._description) s.description = this._description;
    return s;
  }
}

export class ArrayPropertyBuilder extends PropertyBuilder {
  private _items?: JsonSchemaProperty;

  items(schema: JsonSchemaProperty | PropertyBuilder): this {
    this._items = schema instanceof PropertyBuilder ? schema.toSchema() : schema;
    return this;
  }

  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaArray = { type: 'array' };
    if (this._description) s.description = this._description;
    if (this._items) s.items = this._items;
    return s;
  }
}

export class EnumPropertyBuilder extends PropertyBuilder {
  constructor(private readonly _values: string[]) { super(); }

  toSchema(): JsonSchemaProperty {
    const s: JsonSchemaEnum = { type: 'string', enum: this._values };
    if (this._description) s.description = this._description;
    return s;
  }
}

export interface SchemaBuilder {
  string(): StringPropertyBuilder;
  number(): NumberPropertyBuilder;
  integer(): IntegerPropertyBuilder;
  boolean(): BooleanPropertyBuilder;
  array(): ArrayPropertyBuilder;
  enum(values: string[]): EnumPropertyBuilder;
}
