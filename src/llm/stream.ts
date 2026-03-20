import type { Message, ToolCall, StreamChunk } from "./types.ts";

export interface ParsedResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Collects streaming chunks into a complete parsed response.
 * Calls onText for each text chunk (for real-time display).
 */
export async function collectStream(
  stream: AsyncGenerator<StreamChunk>,
  onText?: (chunk: string) => void,
): Promise<ParsedResponse> {
  let content = "";
  const toolCalls: ToolCall[] = [];
  let usage: ParsedResponse["usage"];

  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text":
        if (chunk.content) {
          content += chunk.content;
          onText?.(chunk.content);
        }
        break;

      case "tool_call_end":
        if (chunk.toolCall?.id && chunk.toolCall.function) {
          toolCalls.push({
            id: chunk.toolCall.id,
            type: "function",
            function: {
              name: chunk.toolCall.function.name ?? "",
              arguments: chunk.toolCall.function.arguments ?? "",
            },
          });
        }
        break;

      case "done":
        if (chunk.usage) {
          usage = chunk.usage;
        }
        break;
    }
  }

  return {
    content: content || null,
    toolCalls,
    usage,
  };
}

/**
 * Attempts to repair malformed JSON from tool call arguments.
 * Returns repaired JSON string or null if unrecoverable.
 */
export function repairJSON(raw: string): string | null {
  let s = raw.trim();

  // Remove trailing comma before closing brace/bracket
  s = s.replace(/,\s*([}\]])/g, "$1");

  // Try to close unclosed braces/brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of s) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }

  // Close unclosed strings
  if (inString) s += '"';

  // Close unclosed structures
  while (brackets > 0) {
    s += "]";
    brackets--;
  }
  while (braces > 0) {
    s += "}";
    braces--;
  }

  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}
