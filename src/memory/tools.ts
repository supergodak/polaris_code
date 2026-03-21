import type { MemoryStore } from "./types.ts";
import type { ToolDefinition, ToolResult } from "../tools/types.ts";

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
  return [memoryListTool(store), memoryReadTool(store), memoryWriteTool(store)];
}

function memoryListTool(store: MemoryStore): ToolDefinition {
  return {
    name: "memory_list",
    description:
      "List all saved memories (both global and project-scoped). " +
      "Shows name, type, and description of each memory.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["global", "project", "all"],
          description: "Which memories to list (default: all)",
        },
      },
    },
    permissionLevel: "auto",
    handler: async (args): Promise<ToolResult> => {
      const scope = (args.scope as string | undefined) ?? "all";

      const entries =
        scope === "all"
          ? [...(await store.list("global")), ...(await store.list("project"))]
          : await store.list(scope as "global" | "project");

      if (entries.length === 0) {
        return { success: true, output: "No memories saved yet." };
      }

      const lines = entries.map(
        (e) => `[${e.type}] ${e.name} — ${e.description}`,
      );
      return { success: true, output: lines.join("\n") };
    },
  };
}

function memoryReadTool(store: MemoryStore): ToolDefinition {
  return {
    name: "memory_read",
    description:
      "Read the full content of a saved memory by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the memory to read" },
      },
      required: ["name"],
    },
    permissionLevel: "auto",
    handler: async (args): Promise<ToolResult> => {
      const name = args.name as string;
      const entry = await store.read(name);

      if (!entry) {
        return { success: false, output: "", error: `Memory not found: ${name}` };
      }

      return {
        success: true,
        output: `## ${entry.name} (${entry.type})\n${entry.description}\n\n${entry.content}`,
      };
    },
  };
}

function memoryWriteTool(store: MemoryStore): ToolDefinition {
  return {
    name: "memory_write",
    description:
      "Save or update a memory. Memories persist across sessions. " +
      "Use type 'user' for user preferences, 'project' for project-specific info, " +
      "'feedback' for guidance on approach, 'reference' for external resource pointers.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Memory name (used as filename)" },
        description: { type: "string", description: "One-line description (used for search and auto-loading)" },
        type: {
          type: "string",
          enum: ["user", "project", "feedback", "reference"],
          description: "Memory type",
        },
        content: { type: "string", description: "Memory content (Markdown)" },
        scope: {
          type: "string",
          enum: ["global", "project"],
          description: "Where to save (default: project)",
        },
      },
      required: ["name", "description", "type", "content"],
    },
    permissionLevel: "auto",
    handler: async (args): Promise<ToolResult> => {
      const scope = (args.scope as "global" | "project" | undefined) ?? "project";

      try {
        await store.write(
          {
            name: args.name as string,
            description: args.description as string,
            type: args.type as "user" | "project" | "feedback" | "reference",
            content: args.content as string,
          },
          scope,
        );
        return {
          success: true,
          output: `Memory saved: ${args.name} (${scope})`,
        };
      } catch (e) {
        return {
          success: false,
          output: "",
          error: `Failed to save memory: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}
