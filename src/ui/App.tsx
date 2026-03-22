import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Input } from "./Input.tsx";
import { Spinner } from "./Spinner.tsx";
import { ToolCallDisplay } from "./ToolCall.tsx";
import { Permission } from "./Permission.tsx";
import type { AgentLoop } from "../agent/loop.ts";
import type { AgentState } from "../agent/types.ts";
import chalk from "chalk";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer({ tab: 2 }) as any,
});

interface AppProps {
  agentLoop: AgentLoop;
  version: string;
  modelName: string;
  initialPrompt?: string;
}

function logAssistant(text: string): void {
  const rendered = marked.parse(text, { async: false }) as string;
  // Remove trailing newlines from marked output
  const cleaned = rendered.replace(/\n+$/, "");
  process.stdout.write(`${chalk.white.bold("◆ ")}${cleaned}\n`);
}

interface ToolCallEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
}

interface PendingPermission {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

export function App({ agentLoop, version, modelName, initialPrompt }: AppProps) {
  const { exit } = useApp();
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

  // Write header to stdout once at startup
  const headerWritten = useRef(false);
  useEffect(() => {
    if (!headerWritten.current) {
      headerWritten.current = true;
      process.stdout.write(`\n${chalk.magenta.bold("Polaris")} ${chalk.gray(`v${version}`)} ${chalk.gray(`(${modelName})`)}\n\n`);
    }
  }, []);

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
          // Flush completed tool history to stdout before next iteration
          setToolHistory((prev) => {
            for (const tc of prev) {
              const icon = tc.status === "done" ? chalk.green("✓") : tc.status === "error" ? chalk.red("✗") : chalk.yellow("⟳");
              const argsStr = Object.entries(tc.args)
                .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v.length > 40 ? v.slice(0, 40) + "..." : v}"` : JSON.stringify(v)}`)
                .join(" ");
              process.stdout.write(`  ${icon} ${chalk.yellow(tc.name)}: ${chalk.gray(argsStr)}\n`);
              if (tc.result) {
                const preview = tc.result.split("\n")[0]?.slice(0, 80) ?? "";
                const lineCount = tc.result.split("\n").length;
                const suffix = lineCount > 1 ? chalk.gray(` (+${lineCount - 1} lines)`) : "";
                process.stdout.write(`    ${chalk.gray(preview)}${suffix}\n`);
              }
            }
            return [];
          });
          setPhase("thinking");
          setStreamingText("");
          break;
        case "reasoning":
          // Write reasoning text to stdout — stays in scrollback
          setStreamingText("");
          logAssistant(state.content);
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
        case "tool_result":
          setToolHistory((prev) => {
            // Find the last tool with matching name and update it
            const idx = [...prev].reverse().findIndex((t) => t.name === state.toolName);
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const updated = [...prev];
            updated[realIdx] = {
              ...updated[realIdx]!,
              status: state.success ? "done" as const : "error" as const,
              result: state.result,
            };
            return updated;
          });
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
        return;
      }
      if (cmd === "help") {
        logAssistant("Commands: /plan, /do, /init, /compact, /quit, /clear, /help, /memory");
        return;
      }
      if (cmd === "init") {
        setLastUserInput(text);
        // (response will be written to stdout when complete)
        setIsProcessing(true);
        setToolHistory([]);
        const result = await agentLoop.run(
          "Analyze this project's structure and create a `.polaris/instructions.md` file with project-specific instructions for the AI agent. " +
          "Include: project overview, tech stack, directory structure, build/test commands, coding conventions. " +
          "Use the write_file tool to create the file.",
        );
        setStreamingText("");
        setToolHistory([]);
        logAssistant(result);
        setIsProcessing(false);
        return;
      }
      if (cmd === "plan") {
        agentLoop.setPlanMode(true);
        logAssistant("Plan mode: read-only. Use /do to switch to execution mode.");
        return;
      }
      if (cmd === "do" || cmd === "execute") {
        agentLoop.setPlanMode(false);
        logAssistant("Execution mode: all tools available.");
        return;
      }
      if (cmd === "compact") {
        setIsProcessing(true);
        const { before, after } = await agentLoop.compact();
        logAssistant(`Context compacted: ${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k tokens`);
        setIsProcessing(false);
        return;
      }
      if (cmd === "memory") {
        setLastUserInput(text);
        // (response will be written to stdout when complete)
        setIsProcessing(true);
        const result = await agentLoop.run("List all saved memories");
        logAssistant(result);
        setIsProcessing(false);
        return;
      }
    }

    process.stdout.write(`\n${chalk.bgGray.cyan.bold(` ❯ ${text} `)}\n`);
    setIsProcessing(true);
    setStreamingText("");
    setToolHistory([]);

    const result = await agentLoop.run(text);

    // Flush remaining tool history to stdout
    setToolHistory((prev) => {
      for (const tc of prev) {
        const icon = tc.status === "done" ? chalk.green("✓") : tc.status === "error" ? chalk.red("✗") : chalk.yellow("⟳");
        const argsStr = Object.entries(tc.args)
          .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v.length > 40 ? v.slice(0, 40) + "..." : v}"` : JSON.stringify(v)}`)
          .join(" ");
        process.stdout.write(`  ${icon} ${chalk.yellow(tc.name)}: ${chalk.gray(argsStr)}\n`);
        if (tc.result) {
          const preview = tc.result.split("\n")[0]?.slice(0, 80) ?? "";
          const lineCount = tc.result.split("\n").length;
          const suffix = lineCount > 1 ? chalk.gray(` (+${lineCount - 1} lines)`) : "";
          process.stdout.write(`    ${chalk.gray(preview)}${suffix}\n`);
        }
      }
      return [];
    });

    setStreamingText("");
    logAssistant(result);
    setIsProcessing(false);
  }, [agentLoop, exit]);

  const handlePermission = useCallback((approved: boolean) => {
    if (pendingPermission) {
      pendingPermission.resolve(approved);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  // ESC interrupt: 1st ESC = soft interrupt (stop streaming, show partial),
  //                2nd ESC within 500ms = hard interrupt (kill tools + abort loop)
  const lastEscRef = useRef<number>(0);

  useInput((_input, key) => {
    if (key.escape && isProcessing) {
      const now = Date.now();
      if (now - lastEscRef.current < 500) {
        // 2nd ESC — hard abort: kill subprocesses and stop loop
        agentLoop.abort();
        setStreamingText("");
        setToolHistory([]);
        setPhase("idle");
        setExecutingToolName("");
        setIsProcessing(false);
        logAssistant("(interrupted by user)");
        lastEscRef.current = 0;
      } else {
        // 1st ESC — soft abort: stop LLM streaming, show partial response
        agentLoop.abort();
        if (streamingText) {
          if (streamingText) logAssistant(streamingText);
        }
        setStreamingText("");
        setToolHistory([]);
        setPhase("idle");
        setExecutingToolName("");
        setIsProcessing(false);
        lastEscRef.current = now;
      }
    }
  });

  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : "";

  // Ink dynamic area: ONLY the currently active element + input
  return (
    <Box flexDirection="column">
      {/* Currently running tool */}
      {toolHistory.length > 0 && (
        <Box flexDirection="column">
          {toolHistory.filter((tc) => tc.status === "running").map((tc) => (
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
        <Box marginLeft={2}>
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

      {/* Activity indicator */}
      {isProcessing && !streamingText && !pendingPermission && (
        <Box>
          <Spinner label={
            phase === "thinking" ? `Thinking...${elapsedStr}`
            : phase === "executing" ? `Running ${executingToolName}...${elapsedStr}`
            : phase === "tool_calling" ? `Preparing tool call...${elapsedStr}`
            : `Working...${elapsedStr}`
          } />
          <Text color="gray">  (ESC to interrupt)</Text>
        </Box>
      )}

      {/* Input */}
      {!isProcessing && (
        <Box marginTop={1}>
          <Input
            onSubmit={handleSubmit}
            disabled={isProcessing || !!pendingPermission}
          />
        </Box>
      )}
    </Box>
  );
}
