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
import { createAskUserTool } from "./tools/ask-user.ts";
import type { UserInteraction } from "./agent/types.ts";
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
registry.register(createAskUserTool(interaction));

// Register memory tools
for (const tool of createMemoryTools(memoryStore)) {
  registry.register(tool);
}

// Create agent loop
const agentLoop = new AgentLoop(client, registry, interaction, logger, {
  maxIterations: config.agent.maxIterations,
  maxContextTokens: config.agent.maxContextTokens,
  workDir: process.cwd(),
  memoryContext: memoryContext || undefined,
});

// Render TUI
render(
  <App
    agentLoop={agentLoop}
    version={VERSION}
    modelName={config.llm.model}
  />,
);
