import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { applyDefaults, type PolarisConfig } from "./types.ts";

const CONFIG_FILENAME = "config.json";

function resolveHomePath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function loadConfigFile(configPath?: string): Record<string, unknown> {
  const paths = configPath
    ? [configPath]
    : [join(homedir(), ".polaris", CONFIG_FILENAME)];

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    }
  }
  return {};
}

export interface CLIOverrides {
  model?: string;
  apiBase?: string;
  maxIterations?: number;
  config?: string;
}

export function loadConfig(overrides: CLIOverrides = {}): PolarisConfig {
  const fileData = loadConfigFile(overrides.config);

  // Apply CLI overrides
  if (overrides.model) {
    const llm = (fileData.llm ?? {}) as Record<string, unknown>;
    llm.model = overrides.model;
    fileData.llm = llm;
  }
  if (overrides.apiBase) {
    const llm = (fileData.llm ?? {}) as Record<string, unknown>;
    llm.apiBase = overrides.apiBase;
    fileData.llm = llm;
  }
  if (overrides.maxIterations) {
    const agent = (fileData.agent ?? {}) as Record<string, unknown>;
    agent.maxIterations = overrides.maxIterations;
    fileData.agent = agent;
  }

  const config = applyDefaults(fileData);

  // Resolve ~ paths
  config.memory.globalDir = resolveHomePath(config.memory.globalDir);
  config.logging.dir = resolveHomePath(config.logging.dir);

  return config;
}
