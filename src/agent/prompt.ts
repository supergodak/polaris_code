import { homedir } from "node:os";
import { platform, arch } from "node:process";
import type { ToolDefinition } from "../tools/types.ts";

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

  if (memoryContext) {
    sections.push(`## Memory\n${memoryContext}`);
  }

  return sections.join("\n\n");
}

const CORE_INSTRUCTIONS = `You are Polaris, a local AI coding agent. You read, write, and edit code autonomously.

Rules:
- Use tools to explore before changing code. Read files before editing.
- Be concise. Focus on actions.
- For investigations, use bash one-liners or run_script.`;

const TOOL_CALL_FORMAT = `## How to call tools
Output a JSON object inside <tool_call> tags:

<tool_call>
{"name": "read_file", "arguments": {"path": "src/main.ts"}}
</tool_call>

On error: check diagnostics, re-read file, retry with correct content.`;
