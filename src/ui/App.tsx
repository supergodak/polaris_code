import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import { Input } from "./Input.tsx";
import { Spinner } from "./Spinner.tsx";
import { Permission } from "./Permission.tsx";
import type { AgentLoop } from "../agent/loop.ts";
import type { AgentState } from "../agent/types.ts";

interface AppProps {
  agentLoop: AgentLoop;
  version: string;
  modelName: string;
  initialPrompt?: string;
  askCallback?: { resolveAsk: (answer: string) => void };
}

/** A single line of output in the scrollback log */
interface OutputLine {
  id: number;
  type: "header" | "user" | "assistant" | "tool" | "system";
  text: string;
}

export function App({ agentLoop, version, modelName, initialPrompt, askCallback }: AppProps) {
  const { exit } = useApp();

  // Scrollback log — Static renders each item once, never re-renders
  const [log, setLog] = useState<OutputLine[]>([]);
  const idRef = useRef(0);

  const appendLog = useCallback((type: OutputLine["type"], text: string) => {
    setLog((prev) => [...prev, { id: ++idRef.current, type, text }]);
  }, []);

  // Active state — only these are in the dynamic Ink area
  const [isProcessing, setIsProcessing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "thinking" | "responding" | "executing" | "awaiting_input">("idle");
  const [executingToolName, setExecutingToolName] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [toolOutput, setToolOutput] = useState("");
  const [pendingPermission, setPendingPermission] = useState<{
    toolName: string; args: Record<string, unknown>; resolve: (b: boolean) => void;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Write header once
  const headerDone = useRef(false);
  useEffect(() => {
    if (!headerDone.current) {
      headerDone.current = true;
      appendLog("header", `Polaris v${version} (${modelName})`);
    }
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (isProcessing) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isProcessing]);

  // Single function to finalize streaming text → log
  const finalizeStreaming = useCallback(() => {
    setStreamingText((prev) => {
      if (prev.trim()) appendLog("assistant", prev.trim());
      return "";
    });
  }, [appendLog]);

  // Agent state handler
  useEffect(() => {
    const handle = (state: AgentState) => {
      switch (state.type) {
        case "idle":
          setPhase("idle");
          finalizeStreaming();
          setToolOutput("");
          break;
        case "thinking":
          setPhase("thinking");
          finalizeStreaming();
          break;
        case "reasoning":
          finalizeStreaming();
          appendLog("assistant", state.content);
          break;
        case "tool_calling":
          setStreamingText("");
          {
            const argsStr = Object.entries(state.args)
              .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v.length > 50 ? v.slice(0, 50) + "..." : v}"` : JSON.stringify(v)}`)
              .join(" ");
            appendLog("tool", `⟳ ${state.toolName}: ${argsStr}`);
          }
          break;
        case "tool_result": {
          const icon = state.success ? "✓" : "✗";
          const preview = state.result.split("\n")[0]?.slice(0, 80) ?? "";
          const lines = state.result.split("\n").length;
          const suffix = lines > 1 ? ` (+${lines - 1} lines)` : "";
          appendLog("tool", `${icon} ${state.toolName}: ${preview}${suffix}`);
          break;
        }
        case "executing":
          setPhase("executing");
          setExecutingToolName(state.toolName);
          setToolOutput("");
          if (state.toolName === "ask_user") {
            setPhase("awaiting_input");
          }
          break;
        case "tool_output":
          setToolOutput((prev) => {
            const combined = prev + state.chunk;
            return combined.length > 2000 ? combined.slice(-2000) : combined;
          });
          break;
        case "awaiting_permission":
          setPendingPermission({
            toolName: state.toolName,
            args: state.args,
            resolve: state.resolve,
          });
          break;
        case "responding":
          setPhase("responding");
          if (state.content) setStreamingText(state.content);
          break;
      }
    };

    agentLoop.on("state", handle);
    return () => { agentLoop.off("state", handle); };
  }, [agentLoop, appendLog]);

  // Auto-submit initial prompt
  const initDone = useRef(false);
  useEffect(() => {
    if (initialPrompt && !initDone.current) {
      initDone.current = true;
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

  const handleSubmit = useCallback(async (text: string) => {
    if (text.startsWith("/")) {
      const cmd = text.slice(1).toLowerCase().trim();
      if (cmd === "quit" || cmd === "exit") { exit(); return; }
      if (cmd === "clear") { setLog([]); return; }
      if (cmd === "help") {
        appendLog("system", "Commands: /plan, /do, /init, /compact, /quit, /clear, /help, /memory");
        return;
      }
      if (cmd === "plan") {
        agentLoop.setPlanMode(true);
        appendLog("system", "Plan mode: read-only. Use /do to switch to execution mode.");
        return;
      }
      if (cmd === "do" || cmd === "execute") {
        agentLoop.setPlanMode(false);
        appendLog("system", "Execution mode: all tools available.");
        return;
      }
      if (cmd === "compact") {
        setIsProcessing(true);
        const { before, after } = await agentLoop.compact();
        appendLog("system", `Context compacted: ${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k tokens`);
        setIsProcessing(false);
        return;
      }
      if (cmd === "init") {
        appendLog("user", text);
        setIsProcessing(true);
        const result = await agentLoop.run(
          "Analyze this project's structure and create a `.polaris/instructions.md` file with project-specific instructions for the AI agent. " +
          "Include: project overview, tech stack, directory structure, build/test commands, coding conventions. " +
          "Use the write_file tool to create the file.",
        );
        finalizeStreaming();
        appendLog("assistant", result);
        setIsProcessing(false);
        return;
      }
      if (cmd === "memory") {
        appendLog("user", text);
        setIsProcessing(true);
        const result = await agentLoop.run("List all saved memories");
        appendLog("assistant", result);
        setIsProcessing(false);
        return;
      }
    }

    appendLog("user", text);
    setIsProcessing(true);
    setStreamingText("");

    const result = await agentLoop.run(text);

    setStreamingText("");
    appendLog("assistant", result);
    setIsProcessing(false);
  }, [agentLoop, exit, appendLog]);

  const handleAskResponse = useCallback((answer: string) => {
    appendLog("system", `→ ${answer}`);
    setPhase("executing");
    askCallback?.resolveAsk(answer);
  }, [askCallback, appendLog]);

  const handlePermission = useCallback((approved: boolean) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  // ESC interrupt
  const lastEscRef = useRef<number>(0);
  useInput((_input, key) => {
    if (key.escape && isProcessing) {
      const now = Date.now();
      agentLoop.abort();
      finalizeStreaming();
      setPhase("idle");
      setIsProcessing(false);
      if (now - lastEscRef.current < 500) {
        appendLog("system", "(interrupted by user)");
        lastEscRef.current = 0;
      } else {
        lastEscRef.current = now;
      }
    }
  });

  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : "";

  return (
    <Box flexDirection="column">
      {/* Scrollback — each item rendered once, never re-rendered */}
      <Static items={log}>
        {(item) => (
          <Box key={item.id}>
            {item.type === "header" && (
              <Text color="magenta" bold>{item.text}</Text>
            )}
            {item.type === "user" && (
              <Text backgroundColor="#333333" color="cyan" bold>{` ❯ ${item.text} `}</Text>
            )}
            {item.type === "assistant" && (
              <Text><Text color="white" bold>{"◆ "}</Text>{item.text}</Text>
            )}
            {item.type === "tool" && (
              <Text color="gray">{"  "}{item.text}</Text>
            )}
            {item.type === "system" && (
              <Text color="yellow">{item.text}</Text>
            )}
          </Box>
        )}
      </Static>

      {/* === Dynamic area (minimal) === */}

      {/* Live streaming */}
      {streamingText && (
        <Box>
          <Text color="white" bold>{"◆ "}</Text>
          <Text>{streamingText}</Text>
          <Text color="gray">▍</Text>
        </Box>
      )}

      {/* Tool output */}
      {toolOutput && phase === "executing" && (
        <Box marginLeft={2}>
          <Text color="gray">{toolOutput}</Text>
        </Box>
      )}

      {/* Permission */}
      {pendingPermission && (
        <Permission
          toolName={pendingPermission.toolName}
          args={pendingPermission.args}
          onResolve={handlePermission}
        />
      )}

      {/* Spinner */}
      {isProcessing && !streamingText && !pendingPermission && (
        <Box>
          <Spinner label={
            phase === "thinking" ? `Thinking...${elapsedStr}`
            : phase === "executing" ? `Running ${executingToolName}...${elapsedStr}`
            : `Working...${elapsedStr}`
          } />
          <Text color="gray">  (ESC to interrupt)</Text>
        </Box>
      )}

      {/* Input */}
      {(!isProcessing || phase === "awaiting_input") && (
        <Box marginTop={1}>
          <Input
            onSubmit={phase === "awaiting_input" ? handleAskResponse : handleSubmit}
            disabled={false}
          />
        </Box>
      )}
    </Box>
  );
}
