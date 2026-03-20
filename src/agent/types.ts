export type AgentState =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "tool_calling"; toolName: string; args: Record<string, unknown> }
  | { type: "awaiting_permission"; toolName: string; args: Record<string, unknown>; resolve: (approved: boolean) => void }
  | { type: "executing"; toolName: string }
  | { type: "responding"; content: string };

export interface UserInteraction {
  ask(question: string): Promise<string>;
  requestPermission(tool: string, args: unknown): Promise<boolean>;
}
