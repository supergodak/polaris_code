import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { Chat } from "./Chat.tsx";
import { Input } from "./Input.tsx";
import { Spinner } from "./Spinner.tsx";
import { ToolCallDisplay } from "./ToolCall.tsx";
import { Permission } from "./Permission.tsx";
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
  const [streamingText, setStreamingText] = useState(""); // Live streaming content
  const [activeTool, setActiveTool] = useState<ActiveToolCall | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time counter
  useEffect(() => {
    if (isProcessing) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isProcessing]);

  useEffect(() => {
    const handleState = (state: AgentState) => {
      switch (state.type) {
        case "idle":
          setStateLabel("");
          setActiveTool(null);
          setStreamingText("");
          break;
        case "thinking":
          setActiveTool((prev) =>
            prev && prev.status === "running"
              ? { ...prev, status: "done" }
              : prev,
          );
          setStateLabel("Thinking...");
          setStreamingText("");
          break;
        case "tool_calling":
          setActiveTool({
            name: state.toolName,
            args: state.args,
            status: "running",
          });
          setStreamingText("");
          setStateLabel("");
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
          // Live streaming text update
          setStateLabel("");
          if (state.content) {
            setStreamingText(state.content);
          }
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
          { role: "assistant" as const, content: "Commands: /quit, /clear, /help, /memory" },
        ]);
        return;
      }
      if (cmd === "memory") {
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
    setStreamingText("");

    const result = await agentLoop.run(text);

    setStreamingText("");
    setMessages((prev) => [...prev, { role: "assistant" as const, content: result }]);
    setIsProcessing(false);
  }, [agentLoop, exit]);

  const handlePermission = useCallback((approved: boolean) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : "";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>Polaris</Text>
        <Text color="gray"> v{version} </Text>
        <Text color="gray">({modelName})</Text>
      </Box>

      {/* Chat messages */}
      <Chat messages={messages} />

      {/* Live streaming response */}
      {streamingText && (
        <Box>
          <Text color="white" bold>{"◆ "}</Text>
          <Text>{streamingText}</Text>
          <Text color="gray">▍</Text>
        </Box>
      )}

      {/* Active tool call */}
      {activeTool && (
        <ToolCallDisplay
          name={activeTool.name}
          args={activeTool.args}
          status={activeTool.status}
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

      {/* Status with elapsed time */}
      {isProcessing && stateLabel && (
        <Spinner label={`${stateLabel}${elapsedStr}`} />
      )}

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
