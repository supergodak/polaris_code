import { useState } from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.ts";

interface ToolCallProps {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  durationMs?: number;
}

export function ToolCallDisplay({ name, args, status, result, durationMs }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);

  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${truncate(v, 50)}"` : JSON.stringify(v)}`)
    .join(" ");

  const icon = status === "running" ? "⟳" : status === "done" ? "✓" : "✗";
  const color = status === "running" ? "yellow" : status === "done" ? "green" : "red";
  const duration = durationMs ? ` (${durationMs}ms)` : "";

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Box>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text color="yellow">{name}</Text>
        <Text color="gray">: {argsStr}{duration}</Text>
      </Box>
      {status !== "running" && result && (
        <Box marginLeft={2}>
          <Text color="gray">{truncate(result, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}
