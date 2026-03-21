import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
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
  initialPrompt?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolCallEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
}

interface PendingPermission {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

export function App({ agentLoop, version, modelName, initialPrompt }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "thinking" | "responding" | "tool_calling" | "executing">("idle");
  const [executingToolName, setExecutingToolName] = useState("");
  const [streamingText, setStreamingText] = useState(""); // Live streaming content
  const [toolOutput, setToolOutput] = useState(""); // Real-time tool output
  const [toolHistory, setToolHistory] = useState<ToolCallEntry[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode] = useState<"execute" | "plan">("execute");
  const [contextInfo, setContextInfo] = useState<{ tokens: number; maxTokens: number } | null>(null);
  const [contextPruned, setContextPruned] = useState(false);
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

  // Counter to generate unique IDs for tool calls
  const toolIdCounter = useRef(0);

  useEffect(() => {
    const handleState = (state: AgentState) => {
      switch (state.type) {
        case "idle":
          setPhase("idle");
          setExecutingToolName("");
          setStreamingText("");
          break;
        case "thinking":
          // Mark all running tools as done
          setToolHistory((prev) =>
            prev.map((t) => t.status === "running" ? { ...t, status: "done" as const } : t),
          );
          setPhase("thinking");
          setStreamingText("");
          break;
        case "tool_calling": {
          const id = `tc-${++toolIdCounter.current}`;
          setToolHistory((prev) => [
            ...prev.map((t) => t.status === "running" ? { ...t, status: "done" as const } : t),
            { id, name: state.toolName, args: state.args, status: "running" as const },
          ]);
          setPhase("tool_calling");
          setStreamingText("");
          break;
        }
        case "awaiting_permission":
          setPendingPermission({
            toolName: state.toolName,
            args: state.args,
            resolve: state.resolve,
          });
          break;
        case "executing":
          setPhase("executing");
          setExecutingToolName(state.toolName);
          setToolOutput("");
          break;
        case "tool_output":
          setToolOutput((prev) => {
            const combined = prev + state.chunk;
            // Keep last 2000 chars to avoid memory issues
            return combined.length > 2000 ? combined.slice(-2000) : combined;
          });
          break;
        case "responding":
          setPhase("responding");
          if (state.content) {
            setStreamingText(state.content);
          }
          break;
      }
    };

    const handleMode = (m: string) => setMode(m as "plan" | "execute");

    const handleContext = (info: { tokens: number; maxTokens: number; pruned: boolean; tokensBefore: number }) => {
      setContextInfo({ tokens: info.tokens, maxTokens: info.maxTokens });
      if (info.pruned) {
        setContextPruned(true);
        setTimeout(() => setContextPruned(false), 5000);
      }
    };

    agentLoop.on("state", handleState);
    agentLoop.on("mode", handleMode);
    agentLoop.on("context", handleContext);
    return () => {
      agentLoop.off("state", handleState);
      agentLoop.off("mode", handleMode);
      agentLoop.off("context", handleContext);
    };
  }, [agentLoop]);

  // Auto-submit initial prompt
  const initialPromptSent = useRef(false);
  useEffect(() => {
    if (initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

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
          { role: "assistant" as const, content: "Commands: /plan, /do, /init, /compact, /quit, /clear, /help, /memory" },
        ]);
        return;
      }
      if (cmd === "init") {
        setMessages((prev) => [...prev, { role: "user" as const, content: text }]);
        setIsProcessing(true);
        setToolHistory([]);
        const result = await agentLoop.run(
          "Analyze this project's structure and create a `.polaris/instructions.md` file with project-specific instructions for the AI agent. " +
          "Include: project overview, tech stack, directory structure, build/test commands, coding conventions. " +
          "Use the write_file tool to create the file.",
        );
        setStreamingText("");
        setToolHistory([]);
        setMessages((prev) => [...prev, { role: "assistant" as const, content: result }]);
        setIsProcessing(false);
        return;
      }
      if (cmd === "plan") {
        agentLoop.setPlanMode(true);
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: "Plan mode: read-only. Use /do to switch to execution mode." },
        ]);
        return;
      }
      if (cmd === "do" || cmd === "execute") {
        agentLoop.setPlanMode(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: "Execution mode: all tools available." },
        ]);
        return;
      }
      if (cmd === "compact") {
        setIsProcessing(true);
        const { before, after } = await agentLoop.compact();
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: `Context compacted: ${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k tokens` },
        ]);
        setIsProcessing(false);
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
    setToolHistory([]);

    const result = await agentLoop.run(text);

    setStreamingText("");
    setToolHistory([]);
    setMessages((prev) => [...prev, { role: "assistant" as const, content: result }]);
    setIsProcessing(false);
  }, [agentLoop, exit]);

  const handlePermission = useCallback((approved: boolean) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  // ESC double-tap detection (within 300ms)
  const lastEscRef = useRef<number>(0);

  useInput((_input, key) => {
    if (key.escape && isProcessing) {
      const now = Date.now();
      if (now - lastEscRef.current < 300) {
        // Double-tap detected → abort
        agentLoop.abort();
        setStreamingText("");
        setToolHistory([]);
        setPhase("idle");
        setExecutingToolName("");
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: "(interrupted by user)" },
        ]);
        lastEscRef.current = 0;
      } else {
        lastEscRef.current = now;
      }
    }
  });

  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : "";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>Polaris</Text>
        <Text color="gray"> v{version} </Text>
        <Text color="gray">({modelName})</Text>
        {mode === "plan" && (
          <Text color="yellow" bold>{" "}[PLAN]</Text>
        )}
        {contextInfo && (
          <Text color={contextInfo.tokens > contextInfo.maxTokens * 0.8 ? "yellow" : "gray"}>
            {" "}[ctx: {Math.round(contextInfo.tokens / 1000)}k/{Math.round(contextInfo.maxTokens / 1000)}k]
          </Text>
        )}
      </Box>

      {/* Context pruning notification */}
      {contextPruned && (
        <Box>
          <Text color="yellow">  Context compressed to fit token budget.</Text>
        </Box>
      )}

      {/* Chat messages */}
      <Chat messages={messages} />

      {/* Tool call history */}
      {toolHistory.length > 0 && (
        <Box flexDirection="column">
          {toolHistory.map((tc) => (
            <ToolCallDisplay
              key={tc.id}
              name={tc.name}
              args={tc.args}
              status={tc.status}
            />
          ))}
        </Box>
      )}

      {/* Real-time tool output */}
      {toolOutput && phase === "executing" && (
        <Box marginLeft={2} flexDirection="column">
          <Text color="gray">{toolOutput}</Text>
        </Box>
      )}

      {/* Live streaming response */}
      {streamingText && (
        <Box>
          <Text color="white" bold>{"◆ "}</Text>
          <Text>{streamingText}</Text>
          <Text color="gray">▍</Text>
        </Box>
      )}

      {/* Permission dialog */}
      {pendingPermission && (
        <Permission
          toolName={pendingPermission.toolName}
          args={pendingPermission.args}
          onResolve={handlePermission}
        />
      )}

      {/* Activity indicator — always visible during processing */}
      {isProcessing && (
        <Box>
          <Spinner label={
            phase === "thinking" ? `Thinking...${elapsedStr}`
            : phase === "executing" ? `Running ${executingToolName}...${elapsedStr}`
            : phase === "responding" ? `Streaming...${elapsedStr}`
            : phase === "tool_calling" ? `Preparing tool call...${elapsedStr}`
            : `Working...${elapsedStr}`
          } />
          <Text color="gray">  (ESC ESC to interrupt)</Text>
        </Box>
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
