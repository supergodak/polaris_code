import fg from "fast-glob";
import type { ToolDefinition, ToolResult } from "./types.ts";

export const globTool: ToolDefinition = {
  name: "glob",
  description:
    "Search for files matching a glob pattern. Returns matching file paths. " +
    "Examples: '**/*.ts', 'src/**/*.tsx', '*.json'",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match files" },
      cwd: { type: "string", description: "Directory to search in (default: current working directory)" },
    },
    required: ["pattern"],
  },
  permissionLevel: "auto",
  handler: async (args): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    const cwd = (args.cwd as string | undefined) ?? process.cwd();

    try {
      const files = await fg(pattern, {
        cwd,
        dot: false,
        ignore: ["node_modules/**", ".git/**", "dist/**"],
        onlyFiles: true,
      });

      if (files.length === 0) {
        return { success: true, output: `No files matching pattern: ${pattern}` };
      }

      files.sort();
      const output = files.join("\n");
      const summary = `Found ${files.length} file(s) matching "${pattern}":\n${output}`;
      return { success: true, output: summary };
    } catch (e) {
      return {
        success: false,
        output: "",
        error: `Glob error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
