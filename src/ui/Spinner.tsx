import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import { theme } from "./theme.ts";

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = "Thinking..." }: SpinnerProps) {
  return (
    <Box>
      <Text color="magenta">
        <InkSpinner type="dots" />
      </Text>
      <Text> {theme.dim(label)}</Text>
    </Box>
  );
}
