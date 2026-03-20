import { Box, Text } from "ink";
import { Markdown } from "./Markdown.tsx";
import { theme } from "./theme.ts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatProps {
  messages: ChatMessage[];
}

export function Chat({ messages }: ChatProps) {
  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column">
          <Text color={msg.role === "user" ? "cyan" : "white"} bold>
            {msg.role === "user" ? "❯ " : "◆ "}
          </Text>
          {msg.role === "assistant" ? (
            <Markdown content={msg.content} />
          ) : (
            <Text>{msg.content}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
