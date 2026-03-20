import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

/**
 * Text input with multiline support.
 * - Enter: submit (if content is non-empty)
 * - Shift+Enter or Ctrl+J: insert newline
 * - Backspace: delete last character
 * - Ctrl+U: clear input
 */
export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) return;

    // Ctrl+J or Shift+Enter → insert newline
    if ((key.ctrl && input === "j") || (key.shift && key.return)) {
      setValue((v) => v + "\n");
      return;
    }

    // Enter → submit
    if (key.return) {
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

  // Display: show ↵ for newlines in the input
  const displayLines = value.split("\n");
  const isMultiline = displayLines.length > 1;

  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => (
        <Box key={i}>
          <Text color="cyan" bold>
            {disabled ? "  " : i === 0 ? "❯ " : "  "}
          </Text>
          <Text>{line}</Text>
          {i === displayLines.length - 1 && !disabled && (
            <Text color="gray">█</Text>
          )}
        </Box>
      ))}
      {!disabled && isMultiline && (
        <Text color="gray" dimColor>
          {"  (Ctrl+J: newline, Enter: submit)"}
        </Text>
      )}
    </Box>
  );
}
