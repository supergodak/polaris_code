#!/usr/bin/env bun
import { render } from "ink";
import { Command } from "commander";
import { App } from "./ui/App.tsx";
import { loadConfig } from "./config/settings.ts";
import { LLMClient } from "./llm/client.ts";
import { ToolRegistry } from "./tools/index.ts";
import { AgentLoop } from "./agent/loop.ts";
import { Logger } from "./logging/logger.ts";
import { FileMemoryStore } from "./memory/store.ts";
import { loadRelevantMemories } from "./memory/loader.ts";
import { createMemoryTools } from "./memory/tools.ts";
import { readFileTool } from "./tools/read-file.ts";
import { writeFileTool } from "./tools/write-file.ts";
import { editFileTool } from "./tools/edit-file.ts";
import { globTool } from "./tools/glob.ts";
import { grepTool } from "./tools/grep.ts";
import { bashTool } from "./tools/bash.ts";
import { runScriptTool } from "./tools/run-script.ts";
import { createAskUserTool } from "./tools/ask-user.ts";
import type { UserInteraction } from "./agent/types.ts";
import { saveSession, loadSession, loadLatestSession } from "./agent/session.ts";
import { join } from "node:path";
import chalk from "chalk";

const VERSION = "0.1.0";

const program = new Command()
  .name("polaris")
  .version(VERSION)
  .description("AI Coding Agent powered by local LLMs")
  .option("--model <model>", "Model name")
  .option("--api-base <url>", "LLM server URL")
  .option("--max-iterations <n>", "Max agent loop iterations", parseInt)
  .option("--config <path>", "Config file path")
  .option("--auto-approve", "Skip all permission prompts (use with caution)")
  .option("-p, --print", "Non-interactive mode: run prompt and print result to stdout")
  .option("--allowed-tools <tools>", "Comma-separated list of allowed tools (others are disabled)")
  .option("-c, --continue", "Resume the most recent session")
  .option("--resume <id>", "Resume a specific session by ID")
  .argument("[prompt]", "Initial prompt")
  .parse();

const opts = program.opts();
const initialPrompt = program.args[0];

// Load config
const config = loadConfig({
  model: opts.model,
  apiBase: opts.apiBase,
  maxIterations: opts.maxIterations,
  config: opts.config,
});

// Initialize logger
const logger = new Logger({
  level: config.logging.level,
  dir: config.logging.dir,
});

// Initialize LLM client
const client = new LLMClient({
  apiBase: config.llm.apiBase,
  model: config.llm.model,
  temperature: config.llm.temperature,
  maxTokens: config.llm.maxTokens,
});

// Health check
const healthy = await client.healthCheck();
if (!healthy) {
  console.error(chalk.red(`\n  Error: Cannot connect to LLM server at ${config.llm.apiBase}`));
  console.error(chalk.dim("  Make sure mlx_lm.server is running:"));
  console.error(chalk.dim("  python -m mlx_lm.server --model <model-name>\n"));
  process.exit(3);
}

// Initialize memory store
const projectMemoryDir = join(process.cwd(), ".polaris", "memory");
const memoryStore = new FileMemoryStore(config.memory.globalDir, projectMemoryDir);

// Load relevant memories
let memoryContext = "";
if (config.memory.enabled && config.memory.autoLoad) {
  memoryContext = await loadRelevantMemories(
    memoryStore,
    config.memory.maxInjectionTokens,
    initialPrompt,
  );
}

// TUI-based UserInteraction
class TUIInteraction implements UserInteraction {
  private pendingAsk: ((answer: string) => void) | null = null;
  private pendingPermission: ((approved: boolean) => void) | null = null;

  async ask(question: string): Promise<string> {
    // In full TUI mode, this would render an input prompt
    // For now, use a simple Promise that the UI resolves
    return new Promise((resolve) => {
      this.pendingAsk = resolve;
    });
  }

  async requestPermission(tool: string, args: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingPermission = resolve;
    });
  }

  resolveAsk(answer: string): void {
    this.pendingAsk?.(answer);
    this.pendingAsk = null;
  }

  resolvePermission(approved: boolean): void {
    this.pendingPermission?.(approved);
    this.pendingPermission = null;
  }
}

const interaction = new TUIInteraction();

// Build tool registry
const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(writeFileTool);
registry.register(editFileTool);
registry.register(globTool);
registry.register(grepTool);
registry.register(bashTool);
registry.register(runScriptTool);
registry.register(createAskUserTool(interaction));

// Register memory tools
for (const tool of createMemoryTools(memoryStore)) {
  registry.register(tool);
}

// Apply permission overrides from config
for (const [toolName, level] of Object.entries(config.permissions)) {
  const tool = registry.get(toolName);
  if (tool) {
    tool.permissionLevel = level;
  }
}

// Auto-approve: override all tools to auto (also implied by --print)
if (opts.autoApprove || opts.print) {
  if (!opts.print) {
    console.log(chalk.yellow("\n  ⚠ --auto-approve: All permission checks are disabled.\n"));
  }
  for (const name of registry.names()) {
    const tool = registry.get(name);
    if (tool) {
      tool.permissionLevel = "auto";
    }
  }
}

// Restrict tools if --allowed-tools is specified
if (opts.allowedTools) {
  const allowed = new Set((opts.allowedTools as string).split(",").map((s: string) => s.trim()));
  for (const name of registry.names()) {
    if (!allowed.has(name)) {
      registry.unregister(name);
    }
  }
}

// Create agent loop
const agentLoop = new AgentLoop(client, registry, interaction, logger, {
  maxIterations: config.agent.maxIterations,
  maxContextTokens: config.agent.maxContextTokens,
  workDir: process.cwd(),
  memoryContext: memoryContext || undefined,
});

// Restore session if -c or --resume
let sessionId: string | undefined;
if (opts.resume) {
  const session = loadSession(opts.resume as string);
  if (session) {
    agentLoop.restoreMessages(session.messages);
    sessionId = session.id;
    console.log(chalk.dim(`  Resumed session: ${session.id}\n`));
  } else {
    console.error(chalk.red(`  Session not found: ${opts.resume}`));
    process.exit(1);
  }
} else if (opts.continue) {
  const session = loadLatestSession(process.cwd());
  if (session) {
    agentLoop.restoreMessages(session.messages);
    sessionId = session.id;
    console.log(chalk.dim(`  Resumed session: ${session.id}\n`));
  } else {
    console.log(chalk.dim("  No previous session found. Starting new session.\n"));
  }
}

// Auto-save session on exit
function saveCurrentSession(): void {
  const messages = agentLoop.getMessages();
  if (messages.length > 1) { // more than just system prompt
    sessionId = saveSession(messages, process.cwd(), config.llm.model, sessionId);
  }
}
process.on("exit", saveCurrentSession);
process.on("SIGINT", () => { saveCurrentSession(); process.exit(0); });
process.on("SIGTERM", () => { saveCurrentSession(); process.exit(0); });

// Run in print mode (non-interactive) or TUI mode
if (opts.print) {
  if (!initialPrompt) {
    console.error(chalk.red("Error: -p/--print requires a prompt argument."));
    console.error(chalk.dim("Usage: polaris -p \"your prompt here\""));
    process.exit(1);
  }
  const result = await agentLoop.run(initialPrompt);
  console.log(result);
  process.exit(0);
} else {
  render(
    <App
      agentLoop={agentLoop}
      version={VERSION}
      modelName={config.llm.model}
      initialPrompt={initialPrompt}
      askCallback={interaction}
    />,
  );
}
