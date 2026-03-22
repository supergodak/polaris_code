import type { ChatCompletionTool } from "../llm/types.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  permissionLevel: "auto" | "confirm" | "deny";
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  onOutput?: (chunk: string) => void; // Real-time output callback (set by agent loop)
  abort?: () => void; // Kill running subprocess (set by tool implementation)
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  diagnostics?: EditDiagnostics;
}

export interface EditDiagnostics {
  closest_match?: string;
  similarity?: number;
  line_range?: [number, number];
  hint?: string;
}

export interface ToolProvider {
  name: string;
  tools(): ToolDefinition[];
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export function toOpenAITool(def: ToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}
