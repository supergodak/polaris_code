import { Box, Text } from "ink";

interface ToolCallProps {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  durationMs?: number;
}

export function ToolCallDisplay({ name, args, status, result, durationMs }: ToolCallProps) {
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${truncate(v, 50)}"` : JSON.stringify(v)}`)
    .join(" ");

  const icon = status === "running" ? "⟳" : status === "done" ? "✓" : "✗";
  const color = status === "running" ? "yellow" : status === "done" ? "green" : "red";
  const duration = durationMs ? ` (${durationMs}ms)` : "";

  // Format result preview for inline display
  const preview = result ? formatPreview(name, result, status) : null;

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Box>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text color="yellow">{name}</Text>
        <Text color="gray">: {argsStr}{duration}</Text>
      </Box>
      {preview && (
        <Box marginLeft={3}>
          <Text color={status === "error" ? "red" : "gray"}>{preview}</Text>
        </Box>
      )}
    </Box>
  );
}

function formatPreview(toolName: string, result: string, status: string): string | null {
  if (status === "running") return null;

  // For errors, show the error message
  if (status === "error") {
    return truncate(result, 150);
  }

  // For read_file, show line count
  if (toolName === "read_file") {
    const lines = result.split("\n").length;
    return `${lines} lines`;
  }

  // For grep/glob, show match count
  if (toolName === "grep" || toolName === "glob") {
    const lines = result.trim().split("\n").filter(Boolean);
    return `${lines.length} result${lines.length !== 1 ? "s" : ""}`;
  }

  // For bash/run_script, show first line of output
  if (toolName === "bash" || toolName === "run_script") {
    if (result === "(no output)") return null;
    const firstLine = result.split("\n")[0] ?? "";
    const lineCount = result.split("\n").length;
    if (lineCount > 1) {
      return `${truncate(firstLine, 80)} (+${lineCount - 1} lines)`;
    }
    return truncate(firstLine, 100);
  }

  // For write/edit, show success
  if (toolName === "write_file" || toolName === "edit_file") {
    return truncate(result.split("\n")[0] ?? "", 100);
  }

  return null;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}
