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

export class AgentLoop extends EventEmitter {
  private messages: Message[] = [];
  private client: LLMClient;
  private registry: ToolRegistry;
  private interaction: UserInteraction;
  private logger: Logger;
  private config: AgentLoopConfig;

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

  async run(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });
    this.setState({ type: "thinking" });

    let iterations = 0;
    const maxRetries = 3;

    while (iterations < this.config.maxIterations) {
      iterations++;

      // Prune messages before sending (operate on copy)
      const prunedMessages = pruneMessages(this.messages, this.config.maxContextTokens);

      const startTime = Date.now();

      let content: string | null = null;
      let toolCalls: ToolCall[] = [];

      try {
        const stream = this.client.chat(prunedMessages, this.registry.toOpenAITools());
        const textChunks: string[] = [];

        const result = await collectStream(stream, (chunk) => {
          textChunks.push(chunk);
          this.setState({ type: "responding", content: textChunks.join("") });
        });

        content = result.content;
        toolCalls = result.toolCalls;

        this.logger.llmRequest(prunedMessages, result.usage, Date.now() - startTime);
      } catch (e) {
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
        const result = await this.processToolCall(tc, maxRetries);
        this.messages.push({
          role: "tool",
          content: result.output || result.error || "(no output)",
          tool_call_id: tc.id,
          name: tc.function.name,
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

  private async processToolCall(tc: ToolCall, maxRetries: number): Promise<ToolResult> {
    const toolName = tc.function.name;
    const tool = this.registry.get(toolName);

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

    // Permission check
    this.setState({ type: "tool_calling", toolName, args });

    if (tool.permissionLevel === "deny") {
      return { success: false, output: `Tool '${toolName}' is denied by permission settings.`, error: "DENIED" };
    }

    if (tool.permissionLevel === "confirm") {
      this.setState({
        type: "awaiting_permission",
        toolName,
        args,
        resolve: () => {},
      });
      const approved = await this.interaction.requestPermission(toolName, args);
      if (!approved) {
        return { success: false, output: `User denied execution of '${toolName}'.`, error: "USER_DENIED" };
      }
    }

    // Execute
    this.setState({ type: "executing", toolName });
    const startTime = Date.now();

    try {
      const result = await tool.handler(args);
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
}
