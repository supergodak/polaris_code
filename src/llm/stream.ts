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

  // Fallback: if no tool_calls from API but content contains tool call tags,
  // parse them from the content. Handles mlx_lm.server with Qwen/Hermes models
  // that emit <function>, <tool_call>, or similar XML tags in content.
  if (toolCalls.length === 0 && content) {
    const parsed = parseToolCallsFromContent(content);
    if (parsed.length > 0) {
      toolCalls.push(...parsed);
      // Remove the tool call tags from content
      content = stripToolCallTags(content);
    }
  }

  return {
    content: content || null,
    toolCalls,
    usage,
  };
}

/**
 * Parse tool calls embedded in text content.
 * Supports multiple formats from local LLMs:
 * - <function>...</function>
 * - <tool_call>...</tool_call>
 * - <tools>...</tools>
 * - ```json ... ``` code blocks
 * - Bare JSON with "name" and "arguments" keys
 */
export function parseToolCallsFromContent(content: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  // Pattern 1: XML tags (<function>, <tool_call>, <tools>)
  const tagPatterns = [
    /<function>\s*([\s\S]*?)\s*<\/function>/g,
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
    /<tools>\s*([\s\S]*?)\s*<\/tools>/g,
  ];

  for (const pattern of tagPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const tc = tryParseToolCall(match[1]!.trim());
      if (tc) toolCalls.push(tc);
    }
  }

  if (toolCalls.length > 0) return toolCalls;

  // Pattern 2: ```json ... ``` code blocks
  const codeBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockPattern.exec(content)) !== null) {
    const tc = tryParseToolCall(match[1]!.trim());
    if (tc) toolCalls.push(tc);
  }

  if (toolCalls.length > 0) return toolCalls;

  // Pattern 3: Bare JSON object with "name" and "arguments"
  const bareJsonMatch = content.match(/\{[\s\S]*"name"\s*:\s*"[^"]+"/);
  if (bareJsonMatch) {
    // Find the complete JSON object
    const startIdx = content.indexOf(bareJsonMatch[0]);
    if (startIdx >= 0) {
      const candidate = extractJsonObject(content, startIdx);
      if (candidate) {
        const tc = tryParseToolCall(candidate);
        if (tc) toolCalls.push(tc);
      }
    }
  }

  return toolCalls;
}

function tryParseToolCall(raw: string): ToolCall | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.name && parsed.arguments !== undefined) {
      return {
        id: `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function",
        function: {
          name: parsed.name,
          arguments: typeof parsed.arguments === "string"
            ? parsed.arguments
            : JSON.stringify(parsed.arguments),
        },
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function extractJsonObject(text: string, startIdx: number): string | null {
  let braces = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    if (ch === "}") {
      braces--;
      if (braces === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

export function stripToolCallTags(content: string): string {
  return content
    .replace(/<function>\s*[\s\S]*?\s*<\/function>/g, "")
    .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "")
    .replace(/<tools>\s*[\s\S]*?\s*<\/tools>/g, "")
    .replace(/```(?:json)?\s*\n?\{[\s\S]*?"name"\s*:[\s\S]*?\n?```/g, "")
    .trim();
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
