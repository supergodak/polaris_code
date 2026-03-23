/**
 * LLM output sanitization layer.
 *
 * Responsibilities:
 * 1. Strip special/control tokens that leak from local LLMs
 * 2. Detect degenerate repetition loops and signal abort
 * 3. Enforce maximum output length to prevent runaway generation
 *
 * This module handles all model-specific output quirks so that
 * the agent loop only deals with clean, validated content.
 */

/** Tokens that should never appear in user-facing output */
const SPECIAL_TOKEN_PATTERN = /<\|(?:im_start|im_end|endoftext|end|pad|unk|sep|cls|mask|begin_of_text|end_of_text|eot_id|start_header_id|end_header_id|python_tag|finetune_right_pad_id)\|>/g;

/** Maximum characters of text output before forced stop */
const MAX_OUTPUT_CHARS = 30_000;

export interface SanitizeResult {
  text: string;
  abortReason?: "repetition_loop" | "max_length_exceeded";
}

/**
 * Sanitize a single streaming chunk.
 * Returns cleaned text, or empty string if the chunk was all special tokens.
 */
export function sanitizeChunk(chunk: string): string {
  return chunk.replace(SPECIAL_TOKEN_PATTERN, "");
}

/**
 * Check accumulated text for degenerate patterns.
 * Returns an abort reason if the output should be stopped, or undefined if OK.
 */
export function detectDegenerate(fullText: string): SanitizeResult["abortReason"] {
  // Check max length
  if (fullText.length > MAX_OUTPUT_CHARS) {
    return "max_length_exceeded";
  }

  // Check repetition: extract substantial lines (>20 chars)
  const lines = fullText.split("\n");
  const substantialLines = lines.filter((l) => l.trim().length > 20);

  if (substantialLines.length < 4) return undefined;

  // Count occurrences of each line
  const counts = new Map<string, number>();
  for (const line of substantialLines) {
    const trimmed = line.trim();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }

  // If any single line appears more than 4 times, it's a loop
  for (const [, count] of counts) {
    if (count > 4) {
      return "repetition_loop";
    }
  }

  return undefined;
}

/**
 * Clean final response text (after stream is complete).
 * Strips special tokens, thinking tags, and trims whitespace.
 */
export function sanitizeFinalContent(content: string): string {
  let cleaned = content.replace(SPECIAL_TOKEN_PATTERN, "");

  // Strip <think>...</think> blocks from final content
  // (thinking was already shown during streaming)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "");

  // Handle unclosed <think> tag (stream was cut short)
  cleaned = cleaned.replace(/<think>[\s\S]*$/g, "");

  return cleaned.trim();
}

/**
 * Format a streaming chunk for display.
 * Replaces <think>/<\/think> tags with visual indicators.
 */
export function formatThinkingChunk(chunk: string): string {
  return chunk
    .replace(/<think>/g, "[thinking] ")
    .replace(/<\/think>/g, "\n");
}
