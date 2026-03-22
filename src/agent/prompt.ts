import { homedir } from "node:os";
import { platform, arch } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "../tools/types.ts";

function loadInstructions(workDir: string): string | undefined {
  const paths = [
    join(homedir(), ".polaris", "instructions.md"),       // global
    join(workDir, ".polaris", "instructions.md"),          // project
  ];

  const parts: string[] = [];
  for (const p of paths) {
    if (existsSync(p)) {
      parts.push(readFileSync(p, "utf-8").trim());
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildSystemPrompt(
  tools: ToolDefinition[],
  workDir: string,
  memoryContext?: string,
): string {
  // Compact tool list: just name + one-line description
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description.split(".")[0]}`)
    .join("\n");

  const sections = [
    CORE_INSTRUCTIONS,
    `## Tools\n${toolList}`,
    TOOL_CALL_FORMAT,
    `## Env\nwd: ${workDir} | ${platform} ${arch}`,
  ];

  const instructions = loadInstructions(workDir);
  if (instructions) {
    sections.push(`## Project Instructions\n${instructions}`);
  }

  if (memoryContext) {
    sections.push(`## Memory\n${memoryContext}`);
  }

  return sections.join("\n\n");
}

const CORE_INSTRUCTIONS = `You are Polaris, a local AI coding agent. You read, write, and edit code autonomously.

Rules:
- Think before acting. Your first response to any task must be a plan: explain what you understand and what steps you intend to take. Do NOT use tools in your first response. The user will confirm before you proceed.
- If a request is ambiguous or has multiple possible approaches, ask the user to clarify rather than guessing.
- Use tools to explore before changing code. Read files before editing.
- Be concise. Focus on actions.
- For investigations, use bash one-liners or run_script.
- NEVER run long-running or daemon processes (npm run dev, python -m http.server, docker compose up, etc.). They will block until timeout. Only run commands that terminate.
- If you need to test a server, suggest the user run it manually.`;

const TOOL_CALL_FORMAT = `## How to call tools
Output a JSON object inside <tool_call> tags:

<tool_call>
{"name": "read_file", "arguments": {"path": "src/main.ts"}}
</tool_call>

On error: check diagnostics, re-read file, retry with correct content.`;
