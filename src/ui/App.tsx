import { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { Chat } from "./Chat.tsx";
import { Input } from "./Input.tsx";
import { Spinner } from "./Spinner.tsx";
import { ToolCallDisplay } from "./ToolCall.tsx";
import { Permission } from "./Permission.tsx";
import { theme } from "./theme.ts";
import type { AgentLoop } from "../agent/loop.ts";
import type { AgentState } from "../agent/types.ts";

interface AppProps {
  agentLoop: AgentLoop;
  version: string;
  modelName: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ActiveToolCall {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  durationMs?: number;
}

interface PendingPermission {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

export function App({ agentLoop, version, modelName }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stateLabel, setStateLabel] = useState("");
  const [activeTool, setActiveTool] = useState<ActiveToolCall | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  useEffect(() => {
    const handleState = (state: AgentState) => {
      switch (state.type) {
        case "idle":
          setStateLabel("");
          setActiveTool(null);
          break;
        case "thinking":
          setStateLabel("Thinking...");
          break;
        case "tool_calling":
          setActiveTool({
            name: state.toolName,
            args: state.args,
            status: "running",
          });
          setStateLabel(`Calling ${state.toolName}...`);
          break;
        case "awaiting_permission":
          setPendingPermission({
            toolName: state.toolName,
            args: state.args,
            resolve: state.resolve,
          });
          break;
        case "executing":
          setStateLabel(`Running ${state.toolName}...`);
          break;
        case "responding":
          setStateLabel("");
          break;
      }
    };

    agentLoop.on("state", handleState);
    return () => { agentLoop.off("state", handleState); };
  }, [agentLoop]);

  const handleSubmit = useCallback(async (text: string) => {
    // Slash commands
    if (text.startsWith("/")) {
      const cmd = text.slice(1).toLowerCase().trim();
      if (cmd === "quit" || cmd === "exit") {
        exit();
        return;
      }
      if (cmd === "clear") {
        setMessages([]);
        return;
      }
      if (cmd === "help") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: "Commands: /quit, /clear, /help, /memory",
          },
        ]);
        return;
      }
      if (cmd === "memory") {
        // Trigger memory_list tool
        setMessages((prev) => [...prev, { role: "user" as const, content: text }]);
        setIsProcessing(true);
        const result = await agentLoop.run("List all saved memories");
        setMessages((prev) => [...prev, { role: "assistant" as const, content: result }]);
        setIsProcessing(false);
        return;
      }
    }

    setMessages((prev) => [...prev, { role: "user" as const, content: text }]);
    setIsProcessing(true);

    const result = await agentLoop.run(text);
    setMessages((prev) => [...prev, { role: "assistant" as const, content: result }]);
    setIsProcessing(false);
  }, [agentLoop, exit]);

  const handlePermission = useCallback((approved: boolean) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>
          Polaris
        </Text>
        <Text color="gray"> v{version} </Text>
        <Text color="gray">({modelName})</Text>
      </Box>

      {/* Chat messages */}
      <Chat messages={messages} />

      {/* Active tool call */}
      {activeTool && (
        <ToolCallDisplay
          name={activeTool.name}
          args={activeTool.args}
          status={activeTool.status}
          result={activeTool.result}
          durationMs={activeTool.durationMs}
        />
      )}

      {/* Permission dialog */}
      {pendingPermission && (
        <Permission
          toolName={pendingPermission.toolName}
          args={pendingPermission.args}
          onResolve={handlePermission}
        />
      )}

      {/* Status */}
      {isProcessing && stateLabel && <Spinner label={stateLabel} />}

      {/* Input */}
      <Box marginTop={1}>
        <Input
          onSubmit={handleSubmit}
          disabled={isProcessing || !!pendingPermission}
        />
      </Box>
    </Box>
  );
}
