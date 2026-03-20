import { homedir } from "node:os";
import { platform, arch } from "node:process";
import type { ToolDefinition } from "../tools/types.ts";

export function buildSystemPrompt(
  tools: ToolDefinition[],
  workDir: string,
  memoryContext?: string,
): string {
  const toolDescriptions = tools
    .map((t) => {
      const params = Object.entries(
        (t.parameters as { properties?: Record<string, { type?: string; description?: string }> }).properties ?? {},
      )
        .map(([name, schema]) => `    ${name}: ${schema.type ?? "any"} — ${schema.description ?? ""}`)
        .join("\n");
      return `- **${t.name}**: ${t.description}\n  Parameters:\n${params}`;
    })
    .join("\n\n");

  const sections = [
    CORE_INSTRUCTIONS,
    `## Available Tools\n\n${toolDescriptions}`,
    FEW_SHOT_EXAMPLE,
    ERROR_RECOVERY_INSTRUCTIONS,
    `## Environment\n- Working directory: ${workDir}\n- Platform: ${platform} ${arch}\n- Home: ${homedir()}`,
  ];

  if (memoryContext) {
    sections.push(`## Memory (from previous sessions)\n\n${memoryContext}`);
  }

  return sections.join("\n\n");
}

const CORE_INSTRUCTIONS = `You are Polaris, an AI coding agent running locally. You help users with software engineering tasks by autonomously reading, writing, and editing code.

## Core Behavior
- Use tools to explore the codebase before making changes.
- Read files before editing them.
- When asked to create or modify code, use write_file or edit_file.
- When asked questions about code, use grep and read_file to find answers.
- Be concise in your responses. Focus on actions, not explanations.
- If a task is unclear, use ask_user to clarify.

## Tool Usage Rules
- Call one or more tools per turn to make progress.
- When you have enough information, respond with a text answer (no tool calls) to end the turn.
- For file edits, provide the exact old_string to match. Read the file first if unsure.
- For bash commands, prefer simple, focused commands.`;

const FEW_SHOT_EXAMPLE = `## Example

User: "main.tsの内容を見せて"
Assistant: I'll read the file for you.
[calls read_file with {"path": "src/main.ts"}]`;

const ERROR_RECOVERY_INSTRUCTIONS = `## Error Recovery
- If a tool call fails, read the error message carefully.
- For edit_file failures with EDIT_NO_MATCH, check the diagnostics.closest_match and use read_file to see the exact current content before retrying.
- For edit_file failures with EDIT_NOT_FOUND, the text doesn't exist in the file. Re-read the file to see current content.
- If you get a JSON parse error, check your tool call arguments are valid JSON.`;
