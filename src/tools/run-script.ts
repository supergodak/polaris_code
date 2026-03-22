import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

const SCRATCH_DIR = "/tmp/polaris-scratch";
const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Combined write-run-cleanup tool for investigation scripts.
 * Writes a temporary script, executes it, returns output, and cleans up.
 * Lower friction than write_file + bash for ad-hoc analysis.
 */
export const runScriptTool: ToolDefinition = {
  name: "run_script",
  description:
    "Write a temporary script, execute it, and return the output. The script is automatically deleted after execution. " +
    "Use this for investigations, data analysis, testing hypotheses, or any ad-hoc computation. " +
    "Supported languages: python3, node (JavaScript/TypeScript), bash/sh.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Script source code" },
      language: {
        type: "string",
        description: "Language: 'python', 'node', 'bash' (default: auto-detect from code)",
      },
      args: {
        type: "string",
        description: "Command-line arguments to pass to the script (optional)",
      },
    },
    required: ["code"],
  },
  permissionLevel: "confirm",
  handler: async function (this: ToolDefinition, handlerArgs): Promise<ToolResult> {
    const err = validateStringArgs(handlerArgs, ["code"]);
    if (err) return err;

    const code = handlerArgs.code as string;
    const language = (handlerArgs.language as string | undefined) ?? detectLanguage(code);
    const scriptArgs = (handlerArgs.args as string | undefined) ?? "";

    // Determine extension and interpreter
    const { ext, interpreter } = getInterpreter(language);

    // Write script
    mkdirSync(SCRATCH_DIR, { recursive: true });
    const scriptId = `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scriptPath = join(SCRATCH_DIR, `${scriptId}${ext}`);

    try {
      writeFileSync(scriptPath, code, "utf-8");

      // Execute
      const command = `${interpreter} "${scriptPath}" ${scriptArgs}`.trim();
      const output = await executeScript(command, DEFAULT_TIMEOUT_MS, this);

      return output;
    } finally {
      // Always clean up
      try { unlinkSync(scriptPath); } catch {}
    }
  },
};

function detectLanguage(code: string): string {
  // Simple heuristics
  if (code.includes("import ") && (code.includes("def ") || code.includes("print("))) return "python";
  if (code.includes("require(") || code.includes("console.log") || code.includes("import {")) return "node";
  if (code.startsWith("#!/bin/bash") || code.startsWith("#!/bin/sh") || code.includes("echo ")) return "bash";
  // Default to python for general-purpose scripts
  return "python";
}

function getInterpreter(language: string): { ext: string; interpreter: string } {
  switch (language.toLowerCase()) {
    case "python":
    case "python3":
    case "py":
      return { ext: ".py", interpreter: "python3" };
    case "node":
    case "javascript":
    case "js":
    case "typescript":
    case "ts":
      return { ext: ".mjs", interpreter: "node" };
    case "bash":
    case "sh":
    case "shell":
      return { ext: ".sh", interpreter: "bash" };
    default:
      return { ext: ".py", interpreter: "python3" };
  }
}

const SHELL = process.env.SHELL || "/bin/sh";

function executeScript(command: string, timeout: number, tool?: ToolDefinition): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(SHELL, ["-c", command], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      detached: true,
    });

    const killProcessGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    if (tool) {
      tool.abort = () => { killed = true; killProcessGroup(); };
    }

    const chunks: string[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      killProcessGroup();
    }, timeout);

    child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString("utf-8")));
    child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString("utf-8")));

    child.on("close", (code) => {
      clearTimeout(timer);
      let output = chunks.join("");

      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH) +
          `\n[TRUNCATED: ${output.length} chars total]`;
      }

      if (killed) {
        resolve({ success: false, output, error: `Script timed out after ${timeout}ms` });
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
}
