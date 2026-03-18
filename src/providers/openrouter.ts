import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  MessageContent,
  ToolDefinition,
  StopReason,
  Usage,
} from '../types.js';

// ─── OpenAI-compatible wire types ─────────────────────────────────────────────

interface OAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | OAIContentPart[] | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface OAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

interface OAIChatResponse {
  id: string;
  choices: Array<{
    message: OAIMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OAIStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ─── Message conversion ────────────────────────────────────────────────────────

function toOAIMessages(messages: Message[], systemPrompt?: string): OAIMessage[] {
  const result: OAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as OAIMessage['role'], content: msg.content });
      continue;
    }

    // Complex content — group tool results as separate tool messages
    const toolResults = msg.content.filter((c) => c.type === 'tool_result');
    const otherContent = msg.content.filter((c) => c.type !== 'tool_result');

    if (otherContent.length > 0) {
      const toolCalls: OAIToolCall[] = [];
      const parts: OAIContentPart[] = [];

      for (const part of otherContent) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          parts.push({ type: 'image_url', image_url: { url: part.url } });
        } else if (part.type === 'image_base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${part.mimeType};base64,${part.data}` },
          });
        } else if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: { name: part.name, arguments: JSON.stringify(part.input) },
          });
        }
      }

      const oaiMsg: OAIMessage = {
        role: msg.role as OAIMessage['role'],
        content: parts.length > 0 ? parts : null,
      };
      if (toolCalls.length > 0) oaiMsg.tool_calls = toolCalls;
      result.push(oaiMsg);
    }

    for (const part of toolResults) {
      if (part.type === 'tool_result') {
        result.push({
          role: 'tool',
          tool_call_id: part.toolUseId,
          content: part.content,
        });
      }
    }
  }

  return result;
}

function toOAITools(tools: ToolDefinition[]): OAITool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
      strict: true,
    },
  }));
}

function mapFinishReason(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    case 'stop': return 'end_turn';
    default: return 'end_turn';
  }
}

function extractContent(msg: OAIMessage): MessageContent[] {
  const content: MessageContent[] = [];

  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        content.push({ type: 'text', text: part.text });
      }
    }
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        // leave empty
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  return content;
}

// ─── OpenRouter provider ──────────────────────────────────────────────────────

export interface OpenRouterOptions {
  apiKey: string;
  /** Default model if not specified per-request. */
  defaultModel?: string;
  /** Base URL — defaults to OpenRouter. */
  baseUrl?: string;
  /** Extra headers (e.g. HTTP-Referer, X-Title). */
  headers?: Record<string, string>;
}

export class OpenRouterProvider implements AIProvider {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: OpenRouterOptions) {
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.headers = {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOAIMessages(request.messages, request.systemPrompt),
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = toOAITools(request.tools);
      body['tool_choice'] = 'auto';
    }

    if (request.responseFormat) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name,
          schema: request.responseFormat.schema,
          strict: true,
        },
      };
    }

    if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as OAIChatResponse;
    const choice = json.choices[0];
    if (!choice) throw new Error('No choices returned from OpenRouter');

    return {
      id: json.id,
      content: extractContent(choice.message),
      stopReason: mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOAIMessages(request.messages, request.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = toOAITools(request.tools);
      body['tool_choice'] = 'auto';
    }

    if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter stream error ${res.status}: ${text}`);
    }

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Track in-progress tool calls across chunks
    const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'message_end' };
          return;
        }

        let chunk: OAIStreamChunk;
        try {
          chunk = JSON.parse(data) as OAIStreamChunk;
        } catch {
          continue;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
              yield { type: 'tool_use_start', toolUseId: tc.id ?? String(idx), toolName: tc.function?.name };
            }
            const buf = toolCallBuffers.get(idx)!;
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) {
              buf.args += tc.function.arguments;
              yield { type: 'tool_use_delta', toolUseId: buf.id, toolInputDelta: tc.function.arguments };
            }
          }
        }

        if (choice.finish_reason) {
          // Emit completed tool calls
          for (const [, buf] of toolCallBuffers) {
            yield { type: 'tool_use_end', toolUseId: buf.id, toolName: buf.name };
          }

          const usage: Usage | undefined = chunk.usage
            ? { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens }
            : undefined;

          yield {
            type: 'message_end',
            stopReason: mapFinishReason(choice.finish_reason),
            usage,
          };
        }
      }
    }
  }
}

export function openrouter(options: OpenRouterOptions): OpenRouterProvider {
  return new OpenRouterProvider(options);
}
