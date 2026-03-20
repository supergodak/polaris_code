import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

/**
 * Text input with multiline support.
 * - Enter: submit (unless line ends with \, which inserts a newline)
 * - Backspace: delete last character
 * - Ctrl+U: clear input
 *
 * For multiline input, end a line with \ then press Enter.
 */
export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) return;

    // Enter
    if (key.return) {
      // If line ends with \, treat as line continuation
      if (value.endsWith("\\")) {
        setValue((v) => v.slice(0, -1) + "\n");
        return;
      }
      if (value.trim()) {
        onSubmit(value.trim());
        setValue("");
      }
      return;
    }

    // Ctrl+U → clear input
    if (key.ctrl && input === "u") {
      setValue("");
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    // Ignore other control characters
    if (key.ctrl || key.meta) return;

    if (input) {
      setValue((v) => v + input);
    }
  });

  const displayLines = value.split("\n");

  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => (
        <Box key={i}>
          <Text color="cyan" bold>
            {disabled ? "  " : i === 0 ? "❯ " : "… "}
          </Text>
          <Text>{line}</Text>
          {i === displayLines.length - 1 && !disabled && (
            <Text color="gray">█</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
