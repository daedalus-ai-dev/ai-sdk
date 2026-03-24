import type { AIProvider, Message, MessageContent } from './types.js';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * A context manager controls which messages are sent to the model on each
 * iteration, preventing context overflow in long-running agents.
 *
 * Implement this interface to build a custom strategy, or use one of the
 * built-in factories: `slidingWindow`, `tokenBudget`, or `summarizing`.
 */
export interface ContextManager {
  /**
   * Given the full conversation history, return the messages to send to the
   * model. May be async (e.g. for LLM-based summarization).
   */
  manage(messages: Message[]): Message[] | Promise<Message[]>;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/** Rough token estimate: ~4 characters per token (English text). */
function estimateTokens(message: Message): number {
  if (typeof message.content === 'string') {
    return Math.ceil(message.content.length / 4);
  }
  return message.content.reduce((sum, part) => {
    if (part.type === 'text') return sum + Math.ceil(part.text.length / 4);
    if (part.type === 'tool_result') return sum + Math.ceil(part.content.length / 4);
    if (part.type === 'tool_use') return sum + Math.ceil(JSON.stringify(part.input).length / 4);
    return sum + 10; // small fixed cost for image/other content
  }, 0);
}

function totalTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

// ─── Sliding Window ───────────────────────────────────────────────────────────

/**
 * Keeps only the most recent `maxMessages` messages.
 *
 * Tool use / tool result pairs are always kept together — if a `tool_use`
 * assistant message would be cut, its paired `tool_result` user message is
 * also dropped, preventing malformed conversation state.
 *
 * @param maxMessages Maximum number of messages to send to the model.
 *
 * @example
 * agent({
 *   instructions: '...',
 *   contextManager: slidingWindow(20),
 * });
 */
export function slidingWindow(maxMessages: number): ContextManager {
  return {
    manage(messages: Message[]): Message[] {
      if (messages.length <= maxMessages) return messages;

      let trimmed = messages.slice(-maxMessages);

      // If the first message is a tool_result, its tool_use was cut — drop it
      // too so the conversation doesn't start mid-pair.
      while (trimmed.length > 0 && isToolResultOnly(trimmed[0])) {
        trimmed = trimmed.slice(1);
      }

      return trimmed;
    },
  };
}

/** Returns true if every content item in a user message is a tool_result. */
function isToolResultOnly(message: Message | undefined): boolean {
  if (!message) return false;
  if (message.role !== 'user') return false;
  if (typeof message.content === 'string') return false;
  return (message.content as MessageContent[]).every((c) => c.type === 'tool_result');
}

// ─── Token Budget ─────────────────────────────────────────────────────────────

/**
 * Drops the oldest messages until the estimated token count is under
 * `maxTokens`. Uses a rough 4-characters-per-token heuristic.
 *
 * @param maxTokens Estimated token budget for the conversation history.
 *
 * @example
 * agent({
 *   instructions: '...',
 *   contextManager: tokenBudget(6000),
 * });
 */
export function tokenBudget(maxTokens: number): ContextManager {
  return {
    manage(messages: Message[]): Message[] {
      if (totalTokens(messages) <= maxTokens) return messages;

      let trimmed = [...messages];

      while (trimmed.length > 1 && totalTokens(trimmed) > maxTokens) {
        trimmed = trimmed.slice(1);
        // Drop orphaned tool_result messages at the start
        while (trimmed.length > 0 && isToolResultOnly(trimmed[0])) {
          trimmed = trimmed.slice(1);
        }
      }

      return trimmed;
    },
  };
}

// ─── Summarizing ──────────────────────────────────────────────────────────────

export interface SummarizingOptions {
  /** Provider used to generate the summary. */
  provider: AIProvider;
  /** Model to use for summarization (can differ from the main agent model). */
  model: string;
  /**
   * How many recent messages to keep verbatim. Older messages are summarized.
   * Defaults to 10.
   */
  keepRecent?: number;
  /** Override the summarization prompt. */
  summaryPrompt?: string;
}

/**
 * Summarizes older conversation history into a single message using an LLM
 * call, then appends the most recent messages verbatim.
 *
 * This is the most context-efficient strategy: it preserves recent detail
 * while compressing older context into a concise summary.
 *
 * @example
 * agent({
 *   instructions: '...',
 *   contextManager: summarizing({
 *     provider: anthropic('claude-haiku-4-5'),
 *     model: 'claude-haiku-4-5',
 *     keepRecent: 10,
 *   }),
 * });
 */
export function summarizing(options: SummarizingOptions): ContextManager {
  const keepRecent = options.keepRecent ?? 10;
  const defaultPrompt =
    'Summarize the following conversation history concisely, preserving key decisions, facts, and context that would be needed to continue the conversation:';

  return {
    async manage(messages: Message[]): Promise<Message[]> {
      if (messages.length <= keepRecent) return messages;

      const toSummarize = messages.slice(0, messages.length - keepRecent);
      const recent = messages.slice(-keepRecent);

      const historyText = toSummarize
        .map((m) => {
          const text =
            typeof m.content === 'string'
              ? m.content
              : (m.content as MessageContent[])
                  .filter((c) => c.type === 'text')
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join(' ');
          return `${m.role}: ${text}`;
        })
        .join('\n');

      const prompt = options.summaryPrompt ?? defaultPrompt;

      const response = await options.provider.chat({
        model: options.model,
        messages: [{ role: 'user', content: `${prompt}\n\n${historyText}` }],
      });

      const summaryText = response.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');

      const summaryMessage: Message = {
        role: 'user',
        content: `[Conversation summary]\n${summaryText}`,
      };

      return [summaryMessage, ...recent];
    },
  };
}
