import { generateText, streamText, jsonSchema, type LanguageModel } from 'ai';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  MessageContent,
  StopReason,
} from '../types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface VercelAIOptions {
  /**
   * A Vercel AI SDK LanguageModel instance.
   *
   * @example
   * import { openai } from '@ai-sdk/openai';
   * vercelAI({ model: openai('gpt-4o') })
   *
   * @example
   * import { anthropic } from '@ai-sdk/anthropic';
   * vercelAI({ model: anthropic('claude-sonnet-4-5') })
   *
   * Note: ChatRequest.model is ignored — the model is fixed in the LanguageModel object.
   */
  model: LanguageModel;
}

export function vercelAI(options: VercelAIOptions): AIProvider {
  return new VercelAIProvider(options);
}

// ─── Provider implementation ──────────────────────────────────────────────────

class VercelAIProvider implements AIProvider {
  constructor(private readonly options: VercelAIOptions) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = await generateText({
      model: this.options.model,
      system: request.systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: toVercelMessages(request.messages) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toVercelTools(request) as any,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
    });

    const content: MessageContent[] = [];

    if (result.text) {
      content.push({ type: 'text', text: result.text });
    }

    for (const tc of result.toolCalls) {
      content.push({
        type: 'tool_use',
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input as Record<string, unknown>,
      });
    }

    return {
      id: result.response.id ?? crypto.randomUUID(),
      content,
      stopReason: finishReasonToStopReason(result.finishReason),
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const result = streamText({
      model: this.options.model,
      system: request.systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: toVercelMessages(request.messages) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toVercelTools(request) as any,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
    });

    // Track tool calls we already emitted via tool-input-* events so we
    // don't double-emit when the final 'tool-call' chunk arrives.
    const streamedToolIds = new Set<string>();

    for await (const chunk of result.fullStream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = chunk as any;

      switch (chunk.type) {
        case 'text-delta':
          yield { type: 'text', text: c.text };
          break;

        case 'tool-input-start':
          streamedToolIds.add(c.id as string);
          yield { type: 'tool_use_start', toolUseId: c.id as string, toolName: c.toolName as string };
          break;

        case 'tool-input-delta':
          yield { type: 'tool_use_delta', toolUseId: c.id as string, toolInputDelta: c.delta as string };
          break;

        case 'tool-input-end':
          yield { type: 'tool_use_end', toolUseId: c.id as string };
          break;

        case 'tool-call':
          // Non-streaming path: emit full tool call if not already streamed.
          if (!streamedToolIds.has(c.toolCallId as string)) {
            yield { type: 'tool_use_start', toolUseId: c.toolCallId as string, toolName: c.toolName as string };
            yield { type: 'tool_use_delta', toolUseId: c.toolCallId as string, toolInputDelta: JSON.stringify(c.input) };
            yield { type: 'tool_use_end', toolUseId: c.toolCallId as string };
          }
          break;

        case 'finish-step':
          // Per-step finish — emit message_end with step usage and finish reason.
          yield {
            type: 'message_end',
            stopReason: finishReasonToStopReason(c.finishReason as string),
            usage: c.usage
              ? { inputTokens: (c.usage.inputTokens as number) ?? 0, outputTokens: (c.usage.outputTokens as number) ?? 0 }
              : undefined,
          };
          break;
      }
    }
  }
}

// ─── Message conversion ───────────────────────────────────────────────────────

type VercelMessage =
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string }> }
  | { role: 'assistant'; content: string | Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }> }
  | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: string; isError?: boolean }> };

function toVercelMessages(sdkMessages: Message[]): VercelMessage[] {
  // Build toolUseId→toolName as we go so tool-result messages can include toolName.
  const toolNameById = new Map<string, string>();
  const out: VercelMessage[] = [];

  for (const msg of sdkMessages) {
    if (typeof msg.content === 'string') {
      if (msg.role === 'user' || msg.role === 'assistant') {
        out.push({ role: msg.role, content: msg.content });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
      > = [];

      for (const c of msg.content) {
        if (c.type === 'text') {
          parts.push({ type: 'text', text: c.text });
        } else if (c.type === 'tool_use') {
          toolNameById.set(c.id, c.name);
          parts.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: c.input });
        }
      }

      if (parts.length > 0) out.push({ role: 'assistant', content: parts });
      continue;
    }

    if (msg.role === 'user') {
      const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: string; isError?: boolean }> = [];
      const textParts: Array<{ type: 'text'; text: string }> = [];

      for (const c of msg.content) {
        if (c.type === 'tool_result') {
          toolResults.push({
            type: 'tool-result',
            toolCallId: c.toolUseId,
            toolName: toolNameById.get(c.toolUseId) ?? c.toolUseId,
            output: c.content,
            isError: c.isError,
          });
        } else if (c.type === 'text') {
          textParts.push({ type: 'text', text: c.text });
        }
      }

      // Tool results must be in a separate 'tool' role message in Vercel AI SDK.
      if (toolResults.length > 0) out.push({ role: 'tool', content: toolResults });
      if (textParts.length > 0) out.push({ role: 'user', content: textParts });
    }
  }

  return out;
}

// ─── Tool conversion ──────────────────────────────────────────────────────────

function toVercelTools(
  request: ChatRequest,
): Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> {
  if (!request.tools?.length) return {};

  return Object.fromEntries(
    request.tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        parameters: jsonSchema(tool.inputSchema as Parameters<typeof jsonSchema>[0]),
      },
    ]),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function finishReasonToStopReason(reason: string): StopReason {
  switch (reason) {
    case 'tool-calls': return 'tool_use';
    case 'length':     return 'max_tokens';
    case 'stop':       return 'end_turn';
    default:           return 'end_turn';
  }
}
