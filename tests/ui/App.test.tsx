import { describe, it, expect } from "bun:test";
import React from "react";
import { render as inkRender } from "ink-testing-library";
import { App } from "../../src/ui/App.tsx";
import { AgentLoop } from "../../src/agent/loop.ts";
import { ToolRegistry } from "../../src/tools/index.ts";
import { NullLogger } from "../../src/logging/logger.ts";
import { HeadlessInteraction } from "../../src/tools/ask-user.ts";
import { MockLLMServer } from "../llm/mock-server.ts";
import { LLMClient } from "../../src/llm/client.ts";

function createTestLoop(server: MockLLMServer): AgentLoop {
  const client = new LLMClient({
    apiBase: server.baseURL,
    model: "test",
    temperature: 0,
    maxTokens: 100,
  });
  const registry = new ToolRegistry();
  return new AgentLoop(
    client,
    registry,
    new HeadlessInteraction(),
    new NullLogger(),
    { maxIterations: 5, maxContextTokens: 12000, workDir: "/tmp" },
  );
}

describe("App", () => {
  it("renders without error", () => {
    const server = new MockLLMServer({
      mode: "normal",
      responses: [{ content: "Hi" }],
    });
    server.start();

    const loop = createTestLoop(server);
    const { lastFrame } = (inkRender as Function)(
      <App agentLoop={loop} version="0.1.0" modelName="test-model" />,
    );

    // Header is written to stdout (not Ink), but component should render
    const output = lastFrame()!;
    expect(output).toBeDefined();

    server.stop();
  });

  it("renders input cursor", () => {
    const server = new MockLLMServer({
      mode: "normal",
      responses: [{ content: "Hi" }],
    });
    server.start();

    const loop = createTestLoop(server);
    const { lastFrame } = (inkRender as Function)(
      <App agentLoop={loop} version="0.1.0" modelName="test" />,
    );

    expect(lastFrame()!).toContain("❯");

    server.stop();
  });
});
