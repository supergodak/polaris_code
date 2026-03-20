import { readFileSync, statSync } from "node:fs";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

const DEFAULT_MAX_LINES = 500;

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file at the given path. Returns line-numbered content. " +
    "For large files, use start_line and end_line to read specific sections. " +
    "Default limit is 500 lines.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read (relative or absolute)" },
      start_line: { type: "integer", description: "Start line number (1-based, optional)" },
      end_line: { type: "integer", description: "End line number (inclusive, optional)" },
      max_lines: { type: "integer", description: "Maximum lines to return (default: 500)" },
    },
    required: ["path"],
  },
  permissionLevel: "auto",
  handler: async (args): Promise<ToolResult> => {
    const err = validateStringArgs(args, ["path"]);
    if (err) return err;
    const path = args.path as string;
    const startLine = (args.start_line as number | undefined) ?? 1;
    const maxLines = (args.max_lines as number | undefined) ?? DEFAULT_MAX_LINES;

    try {
      statSync(path); // Check existence
    } catch {
      return { success: false, output: "", error: `File not found: ${path}` };
    }

    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (e) {
      // Binary file or encoding error
      return {
        success: false,
        output: "",
        error: `Cannot read file as text (may be binary): ${path}`,
      };
    }

    // Check for binary content (null bytes)
    if (content.includes("\0")) {
      return {
        success: false,
        output: "",
        error: `Binary file detected: ${path}. Cannot display as text.`,
      };
    }

    const allLines = content.split("\n");
    const totalLines = allLines.length;

    const endLine = args.end_line
      ? Math.min(args.end_line as number, totalLines)
      : Math.min(startLine + maxLines - 1, totalLines);

    const actualStart = Math.max(1, startLine);
    const selectedLines = allLines.slice(actualStart - 1, endLine);

    // Format with line numbers
    const numbered = selectedLines
      .map((line, i) => `${String(actualStart + i).padStart(6)} | ${line}`)
      .join("\n");

    let output = numbered;

    // Add note if file was truncated
    if (endLine < totalLines) {
      output += `\n\n[NOTE: File has ${totalLines} total lines. Showing lines ${actualStart}-${endLine}. Use start_line=${endLine + 1} to continue.]`;
    }

    return { success: true, output };
  },
};
