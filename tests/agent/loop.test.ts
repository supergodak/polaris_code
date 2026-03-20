import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { AgentLoop } from "../../src/agent/loop.ts";
import { LLMClient } from "../../src/llm/client.ts";
import { ToolRegistry } from "../../src/tools/index.ts";
import { NullLogger } from "../../src/logging/logger.ts";
import { HeadlessInteraction } from "../../src/tools/ask-user.ts";
import { MockLLMServer } from "../llm/mock-server.ts";
import type { ToolDefinition } from "../../src/tools/types.ts";
import type { AgentState } from "../../src/agent/types.ts";

function makeTestTool(name: string, output: string): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: { input: { type: "string" } }, required: [] },
    permissionLevel: "auto",
    handler: async () => ({ success: true, output }),
  };
}

describe("AgentLoop", () => {
  describe("text response (no tool calls)", () => {
    let server: MockLLMServer;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "normal",
        responses: [{ content: "Hello! I'm here to help." }],
      });
      server.start();
    });

    afterAll(() => server.stop());

    it("returns text response and enters idle state", async () => {
      const client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0,
        maxTokens: 100,
      });

      const registry = new ToolRegistry();
      const loop = new AgentLoop(client, registry, new HeadlessInteraction(), new NullLogger(), {
        maxIterations: 5,
        maxContextTokens: 12000,
        workDir: "/tmp",
      });

      const states: AgentState[] = [];
      loop.on("state", (s: AgentState) => states.push(s));

      const result = await loop.run("Hello");
      expect(result).toBe("Hello! I'm here to help.");
      expect(states.some((s) => s.type === "idle")).toBe(true);
    });
  });

  describe("single tool call", () => {
    let server: MockLLMServer;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "streaming",
        responses: [
          // First: tool call
          {
            tool_calls: [{
              id: "call_1",
              name: "test_tool",
              arguments: '{"input": "hello"}',
            }],
          },
          // Second: text response after tool result
          { content: "Done! The tool returned: test output" },
        ],
        chunkDelayMs: 1,
      });
      server.start();
    });

    afterAll(() => server.stop());

    it("executes tool and continues loop", async () => {
      const client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0,
        maxTokens: 100,
      });

      const registry = new ToolRegistry();
      registry.register(makeTestTool("test_tool", "test output"));

      const loop = new AgentLoop(client, registry, new HeadlessInteraction(), new NullLogger(), {
        maxIterations: 5,
        maxContextTokens: 12000,
        workDir: "/tmp",
      });

      const states: AgentState[] = [];
      loop.on("state", (s: AgentState) => states.push(s));

      const result = await loop.run("Run the test tool");
      expect(result).toContain("Done!");
      expect(states.some((s) => s.type === "tool_calling")).toBe(true);
      expect(states.some((s) => s.type === "executing")).toBe(true);
    });
  });

  describe("unknown tool recovery", () => {
    let server: MockLLMServer;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "streaming",
        responses: [
          // LLM calls nonexistent tool
          {
            tool_calls: [{
              id: "call_bad",
              name: "nonexistent_tool",
              arguments: "{}",
            }],
          },
          // After error feedback, LLM responds with text
          { content: "Sorry, let me try a different approach." },
        ],
        chunkDelayMs: 1,
      });
      server.start();
    });

    afterAll(() => server.stop());

    it("feeds error back to LLM and recovers", async () => {
      const client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0,
        maxTokens: 100,
      });

      const registry = new ToolRegistry();
      registry.register(makeTestTool("real_tool", "works"));

      const loop = new AgentLoop(client, registry, new HeadlessInteraction(), new NullLogger(), {
        maxIterations: 5,
        maxContextTokens: 12000,
        workDir: "/tmp",
      });

      const result = await loop.run("Do something");
      expect(result).toContain("different approach");

      // Check that error message was added to conversation
      const messages = loop.getMessages();
      const toolMsg = messages.find(
        (m) => m.role === "tool" && m.content.includes("not found"),
      );
      expect(toolMsg).toBeDefined();
    });
  });

  describe("malformed JSON recovery", () => {
    let server: MockLLMServer;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "malformed",
        responses: [{
          tool_calls: [{
            id: "call_bad",
            name: "test_tool",
            arguments: '{"input": "hello"}',
          }],
        }],
      });
      server.start();
    });

    afterAll(() => server.stop());

    it("attempts JSON repair or feeds back parse error", async () => {
      const client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0,
        maxTokens: 100,
      });

      const registry = new ToolRegistry();
      registry.register(makeTestTool("test_tool", "repaired and worked"));

      const loop = new AgentLoop(client, registry, new HeadlessInteraction(), new NullLogger(), {
        maxIterations: 3,
        maxContextTokens: 12000,
        workDir: "/tmp",
      });

      // Should either repair JSON and succeed, or feed back error
      const result = await loop.run("Test malformed");
      // The loop should complete without crashing
      expect(result).toBeTruthy();
    });
  });

  describe("max iterations", () => {
    let server: MockLLMServer;

    beforeAll(() => {
      // Always returns tool calls, never text → will hit max iterations
      server = new MockLLMServer({
        mode: "streaming",
        responses: [{
          tool_calls: [{
            id: "call_loop",
            name: "test_tool",
            arguments: '{}',
          }],
        }],
        chunkDelayMs: 1,
      });
      server.start();
    });

    afterAll(() => server.stop());

    it("stops at max iterations", async () => {
      const client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0,
        maxTokens: 100,
      });

      const registry = new ToolRegistry();
      registry.register(makeTestTool("test_tool", "ok"));

      const loop = new AgentLoop(client, registry, new HeadlessInteraction(), new NullLogger(), {
        maxIterations: 3,
        maxContextTokens: 12000,
        workDir: "/tmp",
      });

      const result = await loop.run("Loop forever");
      expect(result).toContain("maximum iterations");
    });
  });
});
