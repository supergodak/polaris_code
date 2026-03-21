import type { UserInteraction } from "../agent/types.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";

/**
 * Creates the ask_user tool with a given UserInteraction adapter.
 * This allows the same tool definition to work in TUI and headless mode.
 */
export function createAskUserTool(interaction: UserInteraction): ToolDefinition {
  return {
    name: "ask_user",
    description:
      "Ask the user a clarifying question. Use this when you need more information " +
      "to complete the task, or when the request is ambiguous.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
      },
      required: ["question"],
    },
    permissionLevel: "auto",
    handler: async (args): Promise<ToolResult> => {
      const question = args.question as string;
      try {
        const answer = await interaction.ask(question);
        return { success: true, output: answer };
      } catch (e) {
        return {
          success: false,
          output: "",
          error: `Failed to get user input: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}

/**
 * Headless interaction adapter for testing and eval mode.
 * Returns a default response or reads from a queue.
 */
export class HeadlessInteraction implements UserInteraction {
  private responses: string[];
  private index = 0;

  constructor(responses: string[] = ["yes"]) {
    this.responses = responses;
  }

  async ask(_question: string): Promise<string> {
    const resp = this.responses[this.index % this.responses.length] ?? "yes";
    this.index++;
    return resp;
  }

  async requestPermission(_tool: string, _args: unknown): Promise<boolean> {
    return true; // Auto-approve in headless mode
  }
}
