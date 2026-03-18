import type {
  AIProvider,
  Message,
  MessageContent,
  AgentResponse,
  StreamedAgentResponse,
  Usage,
  SchemaFn,
  JsonSchemaObject,
  ChatRequest,
} from './types.js';
import type { Tool } from './tool.js';
import { toolToDefinition } from './tool.js';
import { buildSchema } from './schema.js';

// ─── Agent interface (for class-based agents) ─────────────────────────────────

export interface AgentInterface {
  instructions(): string;
  tools?(): Tool[];
  schema?: SchemaFn;
  model?(): string;
}

// ─── Agent config (for agent() helper) ───────────────────────────────────────

export interface AgentConfig {
  instructions: string;
  tools?: Tool[];
  schema?: SchemaFn;
  model?: string;
  provider?: AIProvider;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
}

// ─── Default provider registry ────────────────────────────────────────────────

let defaultProvider: AIProvider | null = null;
let defaultModel: string = 'openai/gpt-4o-mini';

export function configure(options: { provider?: AIProvider; model?: string }): void {
  if (options.provider) defaultProvider = options.provider;
  if (options.model) defaultModel = options.model;
}

// ─── AgentRunner ──────────────────────────────────────────────────────────────

class AgentRunner {
  private readonly provider: AIProvider | null;
  private readonly model: string;
  private readonly instructions: string;
  private readonly tools: Tool[];
  private readonly schemaFn?: SchemaFn;
  private readonly maxIterations: number;
  private readonly temperature?: number;
  private readonly maxTokens?: number;

  constructor(config: AgentConfig) {
    this.provider = config.provider ?? defaultProvider ?? null;
    this.model = config.model ?? defaultModel;
    this.instructions = config.instructions;
    this.tools = config.tools ?? [];
    this.schemaFn = config.schema;
    this.maxIterations = config.maxIterations ?? 10;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
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
  ): Promise<AgentResponse<T>> {
    const provider = this.resolveProvider();
    const messages: Message[] = [
      ...history,
      { role: 'user', content: input },
    ];

    const toolDefs = this.tools.map(toolToDefinition);

    let responseSchema: JsonSchemaObject | undefined;
    if (this.schemaFn) {
      responseSchema = buildSchema(this.schemaFn);
    }

    const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      const request: ChatRequest = {
        model: this.model,
        messages,
        systemPrompt: this.instructions,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        responseFormat: responseSchema && !toolDefs.length
          ? { type: 'json_schema', schema: responseSchema, name: 'structured_output' }
          : undefined,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      };

      const response = await provider.chat(request);

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;

      // Add assistant message
      messages.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'tool_use') {
        // Find and execute tool calls
        const toolUses = response.content.filter((c) => c.type === 'tool_use');
        const toolResults: MessageContent[] = [];

        await Promise.all(
          toolUses.map(async (part) => {
            if (part.type !== 'tool_use') return;

            const tool = this.tools.find((t) => t.name() === part.name);
            if (!tool) {
              toolResults.push({
                type: 'tool_result',
                toolUseId: part.id,
                content: `Tool "${part.name}" not found.`,
                isError: true,
              });
              return;
            }

            try {
              const result = await tool.handle(part.input);
              toolResults.push({
                type: 'tool_result',
                toolUseId: part.id,
                content: result,
              });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                toolUseId: part.id,
                content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              });
            }
          }),
        );

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // End turn — extract text and optionally parse structured output
      const text = extractText(response.content);
      let structured: T;

      if (this.schemaFn) {
        try {
          structured = JSON.parse(text) as T;
        } catch {
          structured = {} as T;
        }
      } else {
        structured = undefined as unknown as T;
      }

      return {
        text,
        structured,
        usage: totalUsage,
        messages,
      };
    }

    throw new Error(`Agent exceeded maxIterations (${this.maxIterations})`);
  }

  async *stream(input: string, history: Message[] = []): AsyncGenerator<string, StreamedAgentResponse> {
    const provider = this.resolveProvider();
    const messages: Message[] = [
      ...history,
      { role: 'user', content: input },
    ];

    const toolDefs = this.tools.map(toolToDefinition);
    const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
    let iterations = 0;
    let fullText = '';

    while (iterations < this.maxIterations) {
      iterations++;

      const request: ChatRequest = {
        model: this.model,
        messages,
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
            try { input = JSON.parse(tc.args) as Record<string, unknown>; } catch { /* empty */ }
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
              toolResults.push({ type: 'tool_result', toolUseId: id, content: `Tool "${tc.name}" not found.`, isError: true });
              return;
            }
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.args) as Record<string, unknown>; } catch { /* empty */ }
            try {
              const result = await tool.handle(input);
              toolResults.push({ type: 'tool_result', toolUseId: id, content: result });
            } catch (err) {
              toolResults.push({ type: 'tool_result', toolUseId: id, content: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true });
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
): Promise<AgentResponse<T>> {
  const runner = new AgentRunner({
    instructions: agentInstance.instructions(),
    tools: agentInstance.tools?.() ?? [],
    schema: agentInstance.schema,
    model: agentInstance.model?.(),
    provider: options?.provider,
  });

  return runner.prompt<T>(input, options?.history);
}
