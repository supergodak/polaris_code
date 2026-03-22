export type AgentState =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "tool_calling"; toolName: string; args: Record<string, unknown> }
  | { type: "awaiting_permission"; toolName: string; args: Record<string, unknown>; resolve: (approved: boolean) => void }
  | { type: "executing"; toolName: string }
  | { type: "responding"; content: string }
  | { type: "tool_output"; toolName: string; chunk: string }
  | { type: "tool_result"; toolName: string; result: string; success: boolean };

export interface UserInteraction {
  ask(question: string): Promise<string>;
  requestPermission(tool: string, args: unknown): Promise<boolean>;
}
