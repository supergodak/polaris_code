import type { Message } from "../llm/types.ts";
import { estimateTokens } from "../memory/loader.ts";

/**
 * Prune messages to fit within token budget.
 * Returns a COPY — original messages array is not modified.
 *
 * Strategy:
 * 1. System prompt and memory injection → always kept
 * 2. Last 3 turns (6 messages) → always kept
 * 3. Older tool results → compressed to 1-line summary
 * 4. Older assistant reasoning → compressed to 1-line summary
 */
export interface PruneResult {
  messages: Message[];
  tokensBefore: number;
  tokensAfter: number;
  pruned: boolean;
}

export function pruneMessages(
  messages: Message[],
  maxTokens: number,
): PruneResult {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(messageText(m)),
    0,
  );

  if (totalTokens <= maxTokens) {
    return { messages: [...messages], tokensBefore: totalTokens, tokensAfter: totalTokens, pruned: false };
  }

  const result = [...messages];

  // Find the boundary: keep system messages and last 3 turns
  const protectedTailCount = 6; // ~3 turns (user + assistant pairs)
  const protectedTail = Math.max(0, result.length - protectedTailCount);

  // Compress from oldest to newest, stopping at protected tail
  for (let i = 0; i < protectedTail; i++) {
    const msg = result[i]!;

    if (msg.role === "system") continue; // Never compress system

    if (msg.role === "tool") {
      const content = msg.content;
      if (estimateTokens(content) > 100) {
        // Compress tool result to summary
        const firstLine = content.split("\n")[0] ?? "";
        const lineCount = content.split("\n").length;
        result[i] = {
          ...msg,
          content: `[Compressed: ${msg.name} result, ${lineCount} lines. First line: ${firstLine.slice(0, 100)}]`,
        };
      }
    }

    if (msg.role === "assistant" && msg.content) {
      const content = msg.content;
      if (estimateTokens(content) > 200) {
        result[i] = {
          ...msg,
          content: `[Compressed: ${content.slice(0, 150)}...]`,
          tool_calls: msg.tool_calls, // Keep tool_calls reference
        };
      }
    }

    // Check if we're within budget now
    const currentTokens = result.reduce(
      (sum, m) => sum + estimateTokens(messageText(m)),
      0,
    );
    if (currentTokens <= maxTokens) break;
  }

  const tokensAfter = result.reduce(
    (sum, m) => sum + estimateTokens(messageText(m)),
    0,
  );

  return { messages: result, tokensBefore: totalTokens, tokensAfter, pruned: true };
}

function messageText(msg: Message): string {
  if (msg.role === "assistant") {
    return (msg.content ?? "") + (msg.tool_calls?.map((tc) => tc.function.arguments).join("") ?? "");
  }
  return msg.content;
}
