import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.ts";

interface PermissionProps {
  toolName: string;
  args: Record<string, unknown>;
  onResolve: (approved: boolean) => void;
}

export function Permission({ toolName, args, onResolve }: PermissionProps) {
  const [resolved, setResolved] = useState(false);

  useInput((input, key) => {
    if (resolved) return;

    if (input === "y" || input === "Y" || key.return) {
      setResolved(true);
      onResolve(true);
    } else if (input === "n" || input === "N" || key.escape) {
      setResolved(true);
      onResolve(false);
    }
  });

  if (resolved) return null;

  const argsPreview = JSON.stringify(args, null, 2)
    .split("\n")
    .slice(0, 10)
    .join("\n");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        ⚠ Permission Required
      </Text>
      <Box marginTop={1}>
        <Text>
          Tool: <Text color="cyan" bold>{toolName}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{argsPreview}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          Allow? <Text color="green">[y]es</Text> / <Text color="red">[n]o</Text>
        </Text>
      </Box>
    </Box>
  );
}
