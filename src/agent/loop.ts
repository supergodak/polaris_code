import { EventEmitter } from "node:events";
import type { Message, ToolCall } from "../llm/types.ts";
import type { AgentState, UserInteraction } from "./types.ts";
import type { ToolRegistry } from "../tools/index.ts";
import type { ToolResult } from "../tools/types.ts";
import type { LLMClient } from "../llm/client.ts";
import type { Logger } from "../logging/logger.ts";
import { collectStream, repairJSON } from "../llm/stream.ts";
import { pruneMessages } from "./context-manager.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { postEditVerify } from "../tools/post-edit-verify.ts";

export interface AgentLoopConfig {
  maxIterations: number;
  maxContextTokens: number;
  workDir: string;
  memoryContext?: string;
}

// Tools that are blocked in plan mode (read-only mode)
const WRITE_TOOLS = new Set(["write_file", "edit_file", "bash", "run_script"]);

export class AgentLoop extends EventEmitter {
  private messages: Message[] = [];
  private client: LLMClient;
  private registry: ToolRegistry;
  private interaction: UserInteraction;
  private logger: Logger;
  private config: AgentLoopConfig;
  private _planMode = false;
  private _abortController: AbortController | null = null;

  constructor(
    client: LLMClient,
    registry: ToolRegistry,
    interaction: UserInteraction,
    logger: Logger,
    config: AgentLoopConfig,
  ) {
    super();
    this.client = client;
    this.registry = registry;
    this.interaction = interaction;
    this.logger = logger;
    this.config = config;

    // Build and add system prompt
    const systemPrompt = buildSystemPrompt(
      registry.all(),
      config.workDir,
      config.memoryContext,
    );
    this.messages.push({ role: "system", content: systemPrompt });
  }

  private setState(state: AgentState): void {
    this.emit("state", state);
  }

  get planMode(): boolean {
    return this._planMode;
  }

  setPlanMode(enabled: boolean): void {
    this._planMode = enabled;
    this.emit("mode", enabled ? "plan" : "execute");
  }

  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
    }
    // Kill any running subprocess (bash, run_script)
    for (const tool of this.registry.all()) {
      if (tool.abort) {
        tool.abort();
        tool.abort = undefined;
      }
    }
  }

  get isAborted(): boolean {
    return this._abortController?.signal.aborted ?? false;
  }

  async run(userMessage: string): Promise<string> {
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // In plan mode, prepend instruction to only analyze/plan
    const effectiveMessage = this._planMode
      ? `[PLAN MODE - read-only, no file changes allowed]\n${userMessage}`
      : userMessage;
    this.messages.push({ role: "user", content: effectiveMessage });
    this.setState({ type: "thinking" });

    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      if (signal.aborted) {
        this.setState({ type: "idle" });
        return "(interrupted by user)";
      }

      iterations++;

      // Prune messages before sending (operate on copy)
      const pruneResult = pruneMessages(this.messages, this.config.maxContextTokens);
      const prunedMessages = pruneResult.messages;

      // Emit context info for UI
      this.emit("context", {
        tokens: pruneResult.tokensAfter,
        maxTokens: this.config.maxContextTokens,
        pruned: pruneResult.pruned,
        tokensBefore: pruneResult.tokensBefore,
      });

      const startTime = Date.now();

      let content: string | null = null;
      let toolCalls: ToolCall[] = [];

      try {
        const stream = this.client.chat(prunedMessages, this.registry.toOpenAITools());
        const textChunks: string[] = [];

        const result = await collectStream(stream, {
          onText: (chunk) => {
            if (signal.aborted) return;
            textChunks.push(chunk);
            this.setState({ type: "responding", content: textChunks.join("") });
          },
          signal,
        });

        if (signal.aborted) {
          this.messages.push({ role: "assistant", content: textChunks.join("") || "(interrupted)" });
          this.setState({ type: "idle" });
          return "(interrupted by user)";
        }

        content = result.content;
        toolCalls = result.toolCalls;

        this.logger.llmRequest(prunedMessages, result.usage, Date.now() - startTime);
      } catch (e) {
        if (signal.aborted) {
          this.setState({ type: "idle" });
          return "(interrupted by user)";
        }
        this.logger.error("llm_error", { error: String(e) });
        return `Error communicating with LLM: ${e instanceof Error ? e.message : String(e)}`;
      }

      // No tool calls → text response → done
      if (toolCalls.length === 0) {
        const responseText = content ?? "(no response)";
        this.messages.push({ role: "assistant", content: responseText });
        this.setState({ type: "idle" });
        return responseText;
      }

      // Add assistant message with tool calls
      this.messages.push({
        role: "assistant",
        content: content,
        tool_calls: toolCalls,
      });

      // Process each tool call
      for (const tc of toolCalls) {
        if (signal.aborted) {
          this.setState({ type: "idle" });
          return "(interrupted by user)";
        }
        const result = await this.processToolCall(tc);
        const toolOutput = result.output || result.error || "(no output)";
        this.messages.push({
          role: "tool",
          content: toolOutput,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
        this.emit("state", {
          type: "tool_result",
          toolName: tc.function.name,
          result: toolOutput,
          success: result.success,
        });
      }

      this.setState({ type: "thinking" });
    }

    // Max iterations reached
    const msg = `Reached maximum iterations (${this.config.maxIterations}). Stopping agent loop.`;
    this.logger.warn("max_iterations", { iterations: this.config.maxIterations });
    this.setState({ type: "idle" });
    return msg;
  }

  private async processToolCall(tc: ToolCall): Promise<ToolResult> {
    const toolName = tc.function.name;
    const tool = this.registry.get(toolName);

    // Plan mode: block write tools
    if (this._planMode && WRITE_TOOLS.has(toolName)) {
      return {
        success: false,
        output: `[PLAN MODE] Tool '${toolName}' is not available in plan mode. Use /do to switch to execution mode.`,
        error: "PLAN_MODE_BLOCKED",
      };
    }

    // Unknown tool
    if (!tool) {
      const closest = this.registry.findClosest(toolName);
      const hint = closest
        ? `Did you mean '${closest}'?`
        : "";
      const available = this.registry.names().join(", ");
      this.logger.warn("unknown_tool", { name: toolName, closest });
      return {
        success: false,
        output: `Tool '${toolName}' not found. Available tools: ${available}. ${hint}`,
        error: "UNKNOWN_TOOL",
      };
    }

    // Parse arguments
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.function.arguments);
    } catch (parseError) {
      // Try to repair JSON
      const repaired = repairJSON(tc.function.arguments);
      if (repaired) {
        args = JSON.parse(repaired);
        this.logger.info("json_repaired", { tool: toolName, original: tc.function.arguments });
      } else {
        this.logger.warn("json_parse_error", {
          tool: toolName,
          raw: tc.function.arguments.slice(0, 500),
          error: String(parseError),
        });
        return {
          success: false,
          output: `Your tool call had invalid JSON. Error: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
            `The raw output was: ${tc.function.arguments.slice(0, 200)}. ` +
            `Please call the tool again with valid JSON.`,
          error: "INVALID_JSON",
        };
      }
    }

    // Validate required arguments against tool schema
    const schema = tool.parameters as { required?: string[]; properties?: Record<string, unknown> };
    if (schema.required) {
      const missing = schema.required.filter((key) => args[key] === undefined || args[key] === null);
      if (missing.length > 0) {
        const available = schema.properties ? Object.keys(schema.properties).join(", ") : "unknown";
        return {
          success: false,
          output: `Missing required argument(s): ${missing.join(", ")}. Expected arguments: ${available}. Please call '${toolName}' again with the correct arguments.`,
          error: "MISSING_ARGS",
        };
      }
    }

    // Permission check
    this.setState({ type: "tool_calling", toolName, args });

    if (tool.permissionLevel === "deny") {
      return { success: false, output: `Tool '${toolName}' is denied by permission settings.`, error: "DENIED" };
    }

    if (tool.permissionLevel === "confirm") {
      const approved = await new Promise<boolean>((resolve) => {
        this.setState({
          type: "awaiting_permission",
          toolName,
          args,
          resolve,
        });
        // Also notify interaction adapter (for headless mode)
        this.interaction.requestPermission(toolName, args).then(resolve);
      });
      if (!approved) {
        return { success: false, output: `User denied execution of '${toolName}'.`, error: "USER_DENIED" };
      }
    }

    // Execute
    this.setState({ type: "executing", toolName });
    const startTime = Date.now();

    // Set up real-time output callback for tools that support it
    tool.onOutput = (chunk: string) => {
      this.emit("state", { type: "tool_output", toolName, chunk });
    };

    try {
      const result = await tool.handler.call(tool, args);
      const durationMs = Date.now() - startTime;
      this.logger.toolCall(toolName, args, result, durationMs);

      // Post-edit verification for write_file and edit_file
      if (result.success && (toolName === "write_file" || toolName === "edit_file")) {
        const path = args.path as string;
        if (path) {
          const warning = postEditVerify(path);
          if (warning) {
            result.output += `\n\n[WARNING: Syntax error after edit: ${warning}]`;
          }
        }
      }

      return result;
    } catch (e) {
      const durationMs = Date.now() - startTime;
      this.logger.error("tool_error", { tool: toolName, error: String(e), duration_ms: durationMs });
      return {
        success: false,
        output: `Tool execution error: ${e instanceof Error ? e.message : String(e)}`,
        error: "EXECUTION_ERROR",
      };
    }
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  restoreMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  async compact(): Promise<{ before: number; after: number }> {
    const { estimateTokens } = await import("../memory/loader.ts");
    const before = this.messages.reduce(
      (sum, m) => sum + estimateTokens(m.role === "assistant" ? (m.content ?? "") : m.content),
      0,
    );

    // Keep system prompt
    const systemMsg = this.messages.find((m) => m.role === "system");
    if (!systemMsg) return { before, after: before };

    // Build summary request
    const conversationText = this.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role}: ${m.role === "assistant" ? (m.content ?? "(tool call)") : m.content}`)
      .join("\n")
      .slice(0, 8000); // Limit input

    const summaryMessages: Message[] = [
      { role: "system", content: "Summarize the following conversation concisely. Include key decisions, files modified, and current state. Be brief." },
      { role: "user", content: conversationText },
    ];

    try {
      const stream = this.client.chat(summaryMessages, []);
      const result = await collectStream(stream);
      const summary = result.content ?? "(no summary)";

      // Replace conversation with summary
      this.messages = [
        systemMsg,
        { role: "user", content: "[Previous conversation summary]" },
        { role: "assistant", content: summary },
      ];

      const after = this.messages.reduce(
        (sum, m) => sum + estimateTokens(m.role === "assistant" ? (m.content ?? "") : m.content),
        0,
      );

      return { before, after };
    } catch {
      return { before, after: before };
    }
  }
}
