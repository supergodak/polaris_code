export interface PolarisConfig {
  llm: {
    apiBase: string;
    model: string;
    temperature?: number;  // undefined = server default
    maxTokens?: number;    // undefined = server default
  };
  agent: {
    maxIterations: number;
    maxContextTokens: number;
    systemPrompt?: string;
  };
  permissions: Record<string, "auto" | "confirm" | "deny">;
  memory: {
    enabled: boolean;
    globalDir: string;
    autoLoad: boolean;
    maxInjectionTokens: number;
  };
  logging: {
    level: "debug" | "info" | "off";
    dir: string;
  };
}

const DEFAULTS: PolarisConfig = {
  llm: {
    apiBase: "http://localhost:8080/v1",
    model: "mlx-community/Qwen2.5-Coder-32B-Instruct-8bit",
    // temperature: undefined — let server use model's default
    maxTokens: 8192, // Agent needs long outputs for multi-step reasoning
  },
  agent: {
    maxIterations: 80,
    maxContextTokens: 32000,
  },
  permissions: {},
  memory: {
    enabled: true,
    globalDir: "~/.polaris/memory",
    autoLoad: true,
    maxInjectionTokens: 4000,
  },
  logging: {
    level: "info",
    dir: "~/.polaris/logs",
  },
};

export function applyDefaults(partial: Record<string, unknown>): PolarisConfig {
  const llm = { ...DEFAULTS.llm, ...(partial.llm as Record<string, unknown> ?? {}) };
  const agent = { ...DEFAULTS.agent, ...(partial.agent as Record<string, unknown> ?? {}) };
  const permissions = { ...DEFAULTS.permissions, ...(partial.permissions as Record<string, string> ?? {}) };
  const memory = { ...DEFAULTS.memory, ...(partial.memory as Record<string, unknown> ?? {}) };
  const logging = { ...DEFAULTS.logging, ...(partial.logging as Record<string, unknown> ?? {}) };

  return { llm, agent, permissions, memory, logging } as PolarisConfig;
}
