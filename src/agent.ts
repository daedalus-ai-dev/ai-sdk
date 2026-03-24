import { InterruptError } from './checkpoint.js';
import type { ContextManager } from './context-manager.js';
import * as log from './logger.js';
import { buildSchema } from './schema.js';
import type { Tool } from './tool.js';
import { toolToDefinition } from './tool.js';
import type {
  AgentResponse,
  AIProvider,
  ChatRequest,
  Checkpoint,
  InterruptedResponse,
  JsonSchemaObject,
  Message,
  MessageContent,
  SchemaFn,
  SchemaInput,
  StreamedAgentResponse,
  Usage,
} from './types.js';
import { isRawJsonSchema, isZodSchema, zodToJsonSchema } from './zod.js';

// ─── Agent interface (for class-based agents) ─────────────────────────────────

export interface AgentInterface {
  instructions(): string;
  tools?(): Tool[];
  schema?: SchemaInput;
  model?(): string;
}

// ─── Agent config (for agent() helper) ───────────────────────────────────────

export interface AgentConfig {
  instructions: string;
  tools?: Tool[];
  schema?: SchemaInput;
  model?: string;
  provider?: AIProvider;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  /** Strategy for managing conversation history length. */
  contextManager?: ContextManager;
}

// ─── Default provider registry ────────────────────────────────────────────────

let defaultProvider: AIProvider | null = null;
let defaultModel: string = 'openai/gpt-4o-mini';

export function configure(options: {
  provider?: AIProvider;
  model?: string;
  debug?: boolean;
}): void {
  if (options.provider) defaultProvider = options.provider;
  if (options.model) defaultModel = options.model;
  if (options.debug !== undefined) log.setDebug(options.debug);
}

// ─── AgentRunner ──────────────────────────────────────────────────────────────

class AgentRunner {
  private readonly provider: AIProvider | null;
  private readonly model: string;
  private readonly instructions: string;
  private readonly tools: Tool[];
  private readonly schema?: SchemaInput;
  private readonly maxIterations: number;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly contextManager?: ContextManager;

  constructor(config: AgentConfig) {
    this.provider = config.provider ?? defaultProvider ?? null;
    this.model = config.model ?? defaultModel;
    this.instructions = config.instructions;
    this.tools = config.tools ?? [];
    this.schema = config.schema;
    this.maxIterations = config.maxIterations ?? 10;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.contextManager = config.contextManager;
  }

  private resolveProvider(): AIProvider {
    if (!this.provider) {
      throw new Error(
        'No AI provider configured. Call configure({ provider }) first or pass a provider in the agent config.',
      );
    }
    return this.provider;
  }

  async prompt<T = unknown>(
    input: string,
    history: Message[] = [],
  ): Promise<AgentResponse<T> | InterruptedResponse> {
    log.agentPrompt(input);
    const messages: Message[] = [...history, { role: 'user', content: input }];
    return this.runLoop<T>(messages, 0, { inputTokens: 0, outputTokens: 0 });
  }

  /**
   * Resume an interrupted run. Injects the user's answer as the tool result for
   * the pending `ask_user` call, then continues the agent loop from where it stopped.
   *
   * @param checkpoint - The `checkpoint` field from an {@link InterruptedResponse}.
   * @param answer     - The user's reply to the interrupted question.
   */
  async resume<T = unknown>(
    checkpoint: Checkpoint & { pendingToolUseId: string },
    answer: string,
  ): Promise<AgentResponse<T> | InterruptedResponse> {
    const messages: Message[] = [
      ...checkpoint.messages,
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: checkpoint.pendingToolUseId, content: answer }],
      },
    ];
    return this.runLoop<T>(messages, checkpoint.iterations, { ...checkpoint.usage });
  }

  private async runLoop<T>(
    messages: Message[],
    startIterations: number,
    accUsage: Usage,
  ): Promise<AgentResponse<T> | InterruptedResponse> {
    const provider = this.resolveProvider();
    const toolDefs = this.tools.map(toolToDefinition);

    let responseSchema: JsonSchemaObject | undefined;
    if (this.schema) {
      if (isZodSchema(this.schema)) {
        responseSchema = zodToJsonSchema(this.schema);
      } else if (isRawJsonSchema(this.schema)) {
        responseSchema = this.schema as JsonSchemaObject;
      } else {
        responseSchema = buildSchema(this.schema as SchemaFn);
      }
    }

    const totalUsage: Usage = { ...accUsage };
    let iterations = startIterations;

    while (iterations < this.maxIterations) {
      iterations++;
      log.agentIteration(this.model, iterations, this.maxIterations);

      const contextMessages = this.contextManager
        ? await this.contextManager.manage(messages)
        : messages;

      const request: ChatRequest = {
        model: this.model,
        messages: contextMessages,
        systemPrompt: this.instructions,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        responseFormat:
          responseSchema && !toolDefs.length
            ? { type: 'json_schema', schema: responseSchema, name: 'structured_output' }
            : undefined,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      };

      const callStart = Date.now();
      const response = await provider.chat(request);
      const callElapsed = Date.now() - callStart;

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;

      const responseText = extractText(response.content);
      log.agentResponse(response.stopReason, responseText, callElapsed, response.usage);

      messages.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'tool_use') {
        const toolUses = response.content.filter((c) => c.type === 'tool_use');
        const toolResults: MessageContent[] = [];
        let interrupted: InterruptError | null = null;
        let interruptedToolUseId = '';

        await Promise.all(
          toolUses.map(async (part) => {
            if (part.type !== 'tool_use') return;

            const tool = this.tools.find((t) => t.name() === part.name);
            if (!tool) {
              const errMsg = `Tool "${part.name}" not found.`;
              log.agentToolCall(part.name, part.input);
              log.agentToolResult(errMsg, true);
              toolResults.push({
                type: 'tool_result',
                toolUseId: part.id,
                content: errMsg,
                isError: true,
              });
              return;
            }

            log.agentToolCall(part.name, part.input);
            try {
              const result = await tool.handle(part.input);
              log.agentToolResult(result, false);
              toolResults.push({ type: 'tool_result', toolUseId: part.id, content: result });
            } catch (err) {
              if (err instanceof InterruptError) {
                interrupted = err;
                interruptedToolUseId = part.id;
                return; // skip adding a tool_result — resume() will inject it
              }
              const errMsg = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
              log.agentToolResult(errMsg, true);
              toolResults.push({
                type: 'tool_result',
                toolUseId: part.id,
                content: errMsg,
                isError: true,
              });
            }
          }),
        );

        if (interrupted) {
          return {
            interrupted: true,
            question: (interrupted as InterruptError).question,
            checkpoint: {
              messages,
              iterations,
              usage: totalUsage,
              pendingToolUseId: interruptedToolUseId,
            },
          };
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // End turn — extract text and optionally parse structured output
      const text = responseText;
      let structured: T;

      if (this.schema) {
        try {
          const raw = JSON.parse(text) as unknown;
          if (isZodSchema(this.schema)) {
            const result = this.schema.safeParse(raw);
            structured = (result.success ? result.data : raw) as T;
          } else {
            structured = raw as T;
          }
        } catch {
          structured = {} as T;
        }
      } else {
        structured = undefined as unknown as T;
      }

      log.agentDone(totalUsage);
      return {
        text,
        structured,
        usage: totalUsage,
        messages,
        checkpoint: { messages, iterations, usage: totalUsage },
      };
    }

    throw new Error(`Agent exceeded maxIterations (${this.maxIterations})`);
  }

  async *stream(
    input: string,
    history: Message[] = [],
  ): AsyncGenerator<string, StreamedAgentResponse> {
    const provider = this.resolveProvider();
    const messages: Message[] = [...history, { role: 'user', content: input }];

    const toolDefs = this.tools.map(toolToDefinition);
    const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
    let iterations = 0;
    let fullText = '';

    while (iterations < this.maxIterations) {
      iterations++;

      const contextMessages = this.contextManager
        ? await this.contextManager.manage(messages)
        : messages;

      const request: ChatRequest = {
        model: this.model,
        messages: contextMessages,
        systemPrompt: this.instructions,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      };

      const assistantContent: MessageContent[] = [];
      const pendingToolCalls: Map<string, { name: string; args: string }> = new Map();
      let iterText = '';

      for await (const chunk of provider.stream(request)) {
        if (chunk.type === 'text' && chunk.text) {
          iterText += chunk.text;
          fullText += chunk.text;
          yield chunk.text;
        } else if (chunk.type === 'tool_use_start' && chunk.toolUseId) {
          pendingToolCalls.set(chunk.toolUseId, { name: chunk.toolName ?? '', args: '' });
        } else if (chunk.type === 'tool_use_delta' && chunk.toolUseId) {
          const tc = pendingToolCalls.get(chunk.toolUseId);
          if (tc && chunk.toolInputDelta) tc.args += chunk.toolInputDelta;
        } else if (chunk.type === 'message_end') {
          if (chunk.usage) {
            totalUsage.inputTokens += chunk.usage.inputTokens;
            totalUsage.outputTokens += chunk.usage.outputTokens;
          }

          if (iterText) {
            assistantContent.push({ type: 'text', text: iterText });
          }

          for (const [id, tc] of pendingToolCalls) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.args) as Record<string, unknown>;
            } catch {
              /* empty */
            }
            assistantContent.push({ type: 'tool_use', id, name: tc.name, input });
          }
        }
      }

      messages.push({ role: 'assistant', content: assistantContent });

      const hasPendingTools = pendingToolCalls.size > 0;

      if (hasPendingTools) {
        const toolResults: MessageContent[] = [];

        await Promise.all(
          [...pendingToolCalls.entries()].map(async ([id, tc]) => {
            const tool = this.tools.find((t) => t.name() === tc.name);
            if (!tool) {
              toolResults.push({
                type: 'tool_result',
                toolUseId: id,
                content: `Tool "${tc.name}" not found.`,
                isError: true,
              });
              return;
            }
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.args) as Record<string, unknown>;
            } catch {
              /* empty */
            }
            try {
              const result = await tool.handle(input);
              toolResults.push({ type: 'tool_result', toolUseId: id, content: result });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                toolUseId: id,
                content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              });
            }
          }),
        );

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      return {
        text: fullText,
        usage: totalUsage,
        messages,
      };
    }

    throw new Error(`Agent exceeded maxIterations (${this.maxIterations})`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: MessageContent[]): string {
  return content
    .filter((c) => c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an agent from a config object.
 *
 * @example
 * const response = await agent({
 *   instructions: 'You are a helpful assistant.',
 * }).prompt('Hello!');
 */
export function agent(config: AgentConfig): AgentRunner {
  return new AgentRunner(config);
}

/**
 * Run a class-based agent definition.
 *
 * @example
 * class MyAgent implements AgentInterface { ... }
 * const response = await runAgent(new MyAgent(), 'Hello!');
 */
export async function runAgent<T = unknown>(
  agentInstance: AgentInterface,
  input: string,
  options?: { provider?: AIProvider; history?: Message[] },
): Promise<AgentResponse<T> | InterruptedResponse> {
  const runner = new AgentRunner({
    instructions: agentInstance.instructions(),
    tools: agentInstance.tools?.() ?? [],
    schema: agentInstance.schema,
    model: agentInstance.model?.(),
    provider: options?.provider,
  });

  return runner.prompt<T>(input, options?.history);
}
