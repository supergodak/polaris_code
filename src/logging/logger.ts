import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "off";

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  data?: unknown;
  duration_ms?: number;
}

export class Logger {
  private filePath: string | null = null;
  private level: LogLevel;

  constructor(config: { level: LogLevel; dir: string }) {
    this.level = config.level;

    if (config.level !== "off") {
      mkdirSync(config.dir, { recursive: true });
      const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
      this.filePath = join(config.dir, `session-${sessionId}.jsonl`);
    }
  }

  private shouldLog(entryLevel: "debug" | "info" | "warn" | "error"): boolean {
    if (this.level === "off") return false;
    if (this.level === "info" && entryLevel === "debug") return false;
    return true;
  }

  private write(entry: LogEntry): void {
    if (!this.filePath || !this.shouldLog(entry.level)) return;
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.filePath, line, "utf-8");
  }

  debug(event: string, data?: unknown): void {
    this.write({ timestamp: new Date().toISOString(), level: "debug", event, data });
  }

  info(event: string, data?: unknown): void {
    this.write({ timestamp: new Date().toISOString(), level: "info", event, data });
  }

  warn(event: string, data?: unknown): void {
    this.write({ timestamp: new Date().toISOString(), level: "warn", event, data });
  }

  error(event: string, data?: unknown): void {
    this.write({ timestamp: new Date().toISOString(), level: "error", event, data });
  }

  toolCall(toolName: string, args: unknown, result: unknown, durationMs: number): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "tool_call",
      data: { tool: toolName, args, result },
      duration_ms: durationMs,
    });
  }

  llmRequest(messages: unknown[], tokenUsage?: unknown, durationMs?: number): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: "debug",
      event: "llm_request",
      data: { message_count: Array.isArray(messages) ? messages.length : 0, usage: tokenUsage },
      duration_ms: durationMs,
    });
  }

  get sessionFile(): string | null {
    return this.filePath;
  }
}

// No-op logger for testing
export class NullLogger extends Logger {
  constructor() {
    super({ level: "off", dir: "/dev/null" });
  }
}
