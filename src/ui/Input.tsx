import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value.trim());
        setValue("");
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    // Ignore control characters
    if (key.ctrl || key.meta) return;

    if (input) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box>
      <Text color="cyan" bold>
        {disabled ? "  " : "❯ "}
      </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">█</Text>}
    </Box>
  );
}
