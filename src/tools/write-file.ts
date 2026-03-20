import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Create or overwrite a file at the given path. " +
    "Parent directories are created automatically if they don't exist.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["path", "content"],
  },
  permissionLevel: "confirm",
  handler: async (args): Promise<ToolResult> => {
    const path = args.path as string;
    const content = args.content as string;

    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");

      const lineCount = content.split("\n").length;
      return {
        success: true,
        output: `File written: ${path} (${lineCount} lines)`,
      };
    } catch (e) {
      return {
        success: false,
        output: "",
        error: `Failed to write file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
