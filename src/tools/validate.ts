import type { ToolResult } from "./types.ts";

/**
 * Validate that required string arguments are present and are strings.
 * Returns a ToolResult error if validation fails, null if OK.
 */
export function validateStringArgs(
  args: Record<string, unknown>,
  required: string[],
): ToolResult | null {
  for (const key of required) {
    const val = args[key];
    if (val === undefined || val === null) {
      return {
        success: false,
        output: "",
        error: `Missing required argument: ${key}`,
      };
    }
    if (typeof val !== "string") {
      return {
        success: false,
        output: "",
        error: `Argument '${key}' must be a string, got ${typeof val}`,
      };
    }
  }
  return null;
}
