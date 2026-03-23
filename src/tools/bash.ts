import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";
import { killProcessGroup, truncateOutput } from "./utils.ts";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const SHELL = process.env.SHELL || "/bin/sh";

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
  handler: async function (this: ToolDefinition, args): Promise<ToolResult> {
    const err = validateStringArgs(args, ["command"]);
    if (err) return err;
    const command = args.command as string;
    const cwd = (args.cwd as string | undefined) ?? process.cwd();
    const timeout = (args.timeout as number | undefined) ?? DEFAULT_TIMEOUT_MS;
    const onOutput = this?.onOutput;

    return new Promise((resolve) => {
      const child = spawn(SHELL, ["-c", command], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        detached: true,
      });

      let killed = false;

      this.abort = () => { killed = true; killProcessGroup(child); };

      const timer = setTimeout(() => {
        killed = true;
        killProcessGroup(child);
      }, timeout);

      const chunks: string[] = [];

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        chunks.push(text);
        onOutput?.(text);
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        chunks.push(text);
        onOutput?.(text);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const output = truncateOutput(chunks.join(""));

        if (killed) {
          resolve({ success: false, output, error: `Command timed out after ${timeout}ms` });
        } else if (code !== 0) {
          resolve({ success: false, output, error: `Exit code ${code}` });
        } else {
          resolve({ success: true, output: output || "(no output)" });
        }
      });

      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ success: false, output: "", error: `Spawn error: ${e.message}` });
      });
    });
  },
};
