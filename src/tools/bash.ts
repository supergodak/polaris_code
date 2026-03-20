import { exec } from "node:child_process";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_OUTPUT_LENGTH = 50_000;

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute a shell command and return its output. " +
    "Timeout is 120 seconds by default. Use for running tests, builds, git commands, etc.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      cwd: { type: "string", description: "Working directory (default: current directory)" },
      timeout: { type: "integer", description: "Timeout in milliseconds (default: 120000)" },
    },
    required: ["command"],
  },
  permissionLevel: "confirm",
  handler: async (args): Promise<ToolResult> => {
    const err = validateStringArgs(args, ["command"]);
    if (err) return err;
    const command = args.command as string;
    const cwd = (args.cwd as string | undefined) ?? process.cwd();
    const timeout = (args.timeout as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf-8",
          shell: "/bin/zsh",
        },
        (error, stdout, stderr) => {
          let output = "";
          if (stdout) output += stdout;
          if (stderr) output += (output ? "\n" : "") + stderr;

          // Truncate very long output
          if (output.length > MAX_OUTPUT_LENGTH) {
            output = output.slice(0, MAX_OUTPUT_LENGTH) +
              `\n\n[OUTPUT TRUNCATED: ${output.length} chars total, showing first ${MAX_OUTPUT_LENGTH}]`;
          }

          if (error) {
            if (error.killed) {
              resolve({
                success: false,
                output,
                error: `Command timed out after ${timeout}ms`,
              });
            } else {
              resolve({
                success: false,
                output,
                error: `Exit code ${error.code}: ${error.message}`,
              });
            }
          } else {
            resolve({ success: true, output: output || "(no output)" });
          }
        },
      );
    });
  },
};
