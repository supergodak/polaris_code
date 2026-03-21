import { readFileSync, writeFileSync } from "node:fs";
import type { ToolDefinition, ToolResult, EditDiagnostics } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace a specific string in an existing file. Provide the exact text to find (old_string) " +
    "and the replacement text (new_string). If the exact match fails, the tool will attempt " +
    "trimmed matching and fuzzy matching, and return diagnostic information to help you retry.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      old_string: { type: "string", description: "Exact text to find and replace" },
      new_string: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_string", "new_string"],
  },
  permissionLevel: "confirm",
  handler: async (args): Promise<ToolResult> => {
    const err = validateStringArgs(args, ["path", "old_string", "new_string"]);
    if (err) return err;
    const path = args.path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      return { success: false, output: "", error: `File not found: ${path}` };
    }

    // Step 1: Exact match
    if (content.includes(oldString)) {
      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: "",
          error: `Multiple matches found (${occurrences}). Provide more context in old_string to make it unique.`,
        };
      }

      const newContent = content.replace(oldString, newString);
      writeFileSync(path, newContent, "utf-8");
      const lineCount = newContent.split("\n").length;
      return { success: true, output: `Edit applied. File now has ${lineCount} lines.` };
    }

    // Step 2: Trimmed match (normalize whitespace)
    const trimmedOld = normalizeWhitespace(oldString);
    const lines = content.split("\n");
    const trimResult = findTrimmedMatch(lines, trimmedOld);

    if (trimResult) {
      const originalText = lines.slice(trimResult.start, trimResult.end + 1).join("\n");
      const newContent = content.replace(originalText, newString);
      writeFileSync(path, newContent, "utf-8");
      const lineCount = newContent.split("\n").length;
      return {
        success: true,
        output: `Edit applied (trimmed match at lines ${trimResult.start + 1}-${trimResult.end + 1}). File now has ${lineCount} lines.`,
      };
    }

    // Step 3: Fuzzy match
    const fuzzyResult = findFuzzyMatch(lines, oldString);
    if (fuzzyResult) {
      const diagnostics: EditDiagnostics = {
        closest_match: fuzzyResult.text,
        similarity: fuzzyResult.similarity,
        line_range: [fuzzyResult.startLine + 1, fuzzyResult.endLine + 1],
        hint: `Did you mean the content at lines ${fuzzyResult.startLine + 1}-${fuzzyResult.endLine + 1}? ` +
          `Try read_file with start_line=${Math.max(1, fuzzyResult.startLine - 1)}, ` +
          `end_line=${fuzzyResult.endLine + 3} to see the exact content, then retry.`,
      };
      return {
        success: false,
        output: "No exact match found for old_string.",
        error: "EDIT_NO_MATCH",
        diagnostics,
      };
    }

    return {
      success: false,
      output: "No match found. The specified text does not exist in the file.",
      error: "EDIT_NOT_FOUND",
    };
  },
};

// --- Helper functions ---

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")  // Remove zero-width chars
    .replace(/\u00A0/g, " ")                        // NBSP → regular space
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

interface TrimmedMatchResult {
  start: number;
  end: number;
}

function findTrimmedMatch(lines: string[], trimmedTarget: string): TrimmedMatchResult | null {
  const targetLines = trimmedTarget.split("\n");
  const targetLen = targetLines.length;

  for (let i = 0; i <= lines.length - targetLen; i++) {
    let match = true;
    for (let j = 0; j < targetLen; j++) {
      const sourceLine = normalizeWhitespace(lines[i + j]!);
      if (sourceLine !== targetLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return { start: i, end: i + targetLen - 1 };
    }
  }
  return null;
}

interface FuzzyMatchResult {
  text: string;
  similarity: number;
  startLine: number;
  endLine: number;
}

function findFuzzyMatch(lines: string[], target: string): FuzzyMatchResult | null {
  const targetLines = target.split("\n");
  const targetLen = targetLines.length;

  // For large targets (50+ lines), use line-by-line comparison
  if (targetLen > 50) {
    return findFuzzyMatchByLines(lines, targetLines);
  }

  let best: FuzzyMatchResult | null = null;

  // Slide a window of targetLen lines across the file
  for (let i = 0; i <= lines.length - targetLen; i++) {
    const windowText = lines.slice(i, i + targetLen).join("\n");
    const sim = calculateSimilarity(target, windowText);
    if (sim > (best?.similarity ?? 0.6)) {
      best = {
        text: windowText,
        similarity: sim,
        startLine: i,
        endLine: i + targetLen - 1,
      };
    }
  }

  return best;
}

function findFuzzyMatchByLines(lines: string[], targetLines: string[]): FuzzyMatchResult | null {
  const targetLen = targetLines.length;
  let best: FuzzyMatchResult | null = null;

  for (let i = 0; i <= lines.length - targetLen; i++) {
    let matchingLines = 0;
    for (let j = 0; j < targetLen; j++) {
      if (normalizeWhitespace(lines[i + j]!) === normalizeWhitespace(targetLines[j]!)) {
        matchingLines++;
      }
    }
    const sim = matchingLines / targetLen;
    if (sim > (best?.similarity ?? 0.6)) {
      best = {
        text: lines.slice(i, i + targetLen).join("\n"),
        similarity: sim,
        startLine: i,
        endLine: i + targetLen - 1,
      };
    }
  }

  return best;
}

function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Use character-level bigram similarity (Dice coefficient)
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}
