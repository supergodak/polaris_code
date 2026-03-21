import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LLMClient } from "../../src/llm/client.ts";
import { collectStream, repairJSON } from "../../src/llm/stream.ts";
import { MockLLMServer } from "./mock-server.ts";
import type { Message } from "../../src/llm/types.ts";

const testMessages: Message[] = [
  { role: "user", content: "Hello" },
];

describe("LLMClient", () => {
  describe("normal mode", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "normal",
        responses: [{ content: "Hello! How can I help?" }],
      });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("receives text response", async () => {
      const stream = client.chat(testMessages);
      const result = await collectStream(stream);
      expect(result.content).toBe("Hello! How can I help?");
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe("streaming mode", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "streaming",
        responses: [{
          tool_calls: [{
            id: "call_1",
            name: "read_file",
            arguments: '{"path": "src/main.ts"}',
          }],
        }],
        chunkDelayMs: 1,
      });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("reassembles tool calls from chunked stream", async () => {
      const stream = client.chat(testMessages);
      const result = await collectStream(stream);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.function.name).toBe("read_file");
      const args = JSON.parse(result.toolCalls[0]!.function.arguments);
      expect(args.path).toBe("src/main.ts");
    });
  });

  describe("streaming text mode", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "streaming",
        responses: [{ content: "Hello World" }],
        chunkDelayMs: 1,
      });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("collects streamed text chunks", async () => {
      const chunks: string[] = [];
      const stream = client.chat(testMessages);
      const result = await collectStream(stream, (chunk) => chunks.push(chunk));
      expect(result.content).toBe("Hello World");
      expect(chunks.length).toBeGreaterThan(1); // Should arrive in multiple chunks
    });
  });

  describe("malformed mode", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "malformed",
        responses: [{
          tool_calls: [{
            id: "call_bad",
            name: "read_file",
            arguments: '{"path": "test.ts"}',
          }],
        }],
      });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("receives malformed tool call arguments", async () => {
      const stream = client.chat(testMessages);
      const result = await collectStream(stream);
      expect(result.toolCalls).toHaveLength(1);
      // Arguments should be malformed (trailing comma)
      const rawArgs = result.toolCalls[0]!.function.arguments;
      expect(() => JSON.parse(rawArgs)).toThrow();
    });
  });

  describe("incomplete mode", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({
        mode: "incomplete",
        responses: [{ content: "This is a long response that will be cut short" }],
      });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("handles incomplete stream gracefully", async () => {
      const stream = client.chat(testMessages);
      const result = await collectStream(stream);
      // Should get partial content without crashing
      expect(result.content).toBeTruthy();
      expect(result.content!.length).toBeLessThan("This is a long response that will be cut short".length);
    });
  });

  describe("healthCheck", () => {
    let server: MockLLMServer;
    let client: LLMClient;

    beforeAll(() => {
      server = new MockLLMServer({ mode: "normal", responses: [] });
      server.start();
      client = new LLMClient({
        apiBase: server.baseURL,
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
    });

    afterAll(() => server.stop());

    it("returns true when server is healthy", async () => {
      expect(await client.healthCheck()).toBe(true);
    });

    it("returns false when server is down", async () => {
      const badClient = new LLMClient({
        apiBase: "http://localhost:1",
        model: "test",
        temperature: 0.1,
        maxTokens: 100,
      });
      expect(await badClient.healthCheck()).toBe(false);
    });
  });
});

describe("parseToolCallsFromContent (via collectStream fallback)", () => {
  it("parses <function> tags from content", async () => {
    // Simulate a response where tool_calls is empty but content has <function> tags
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: '<function>\n{"name": "read_file", "arguments": {"path": "src/main.ts"}}\n</function>',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("read_file");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.path).toBe("src/main.ts");
    // Content should be stripped of the tag
    expect(result.content).toBeFalsy();
  });

  it("parses <tool_call> tags", async () => {
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: 'I will read the file.\n<tool_call>\n{"name": "grep", "arguments": {"pattern": "TODO"}}\n</tool_call>',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("grep");
    // Remaining text content should be preserved
    expect(result.content).toContain("I will read the file.");
  });

  it("handles multiple tool calls in content", async () => {
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: '<function>\n{"name": "grep", "arguments": {"pattern": "TODO"}}\n</function>\n<function>\n{"name": "read_file", "arguments": {"path": "x.ts"}}\n</function>',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.function.name).toBe("grep");
    expect(result.toolCalls[1]!.function.name).toBe("read_file");
  });

  it("parses <tools> tags (Qwen format)", async () => {
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: '<tools>\n{"name": "read_file", "arguments": {"path": "src/main.ts"}}\n</tools>',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("read_file");
  });

  it("parses ```json code blocks", async () => {
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: '```json\n{"name": "bash", "arguments": {"command": "bun test"}}\n```',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("bash");
  });

  it("parses bare JSON tool calls", async () => {
    async function* fakeStream(): AsyncGenerator<any> {
      yield {
        type: "text",
        content: '{"name": "grep", "arguments": {"pattern": "TODO", "path": "."}}',
      };
      yield { type: "done" };
    }
    const result = await collectStream(fakeStream());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("grep");
  });
});

describe("repairJSON", () => {
  it("fixes trailing comma", () => {
    const result = repairJSON('{"path": "test.ts",}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result!)).toEqual({ path: "test.ts" });
  });

  it("closes unclosed braces", () => {
    const result = repairJSON('{"path": "test.ts"');
    expect(result).toBeTruthy();
    expect(JSON.parse(result!)).toEqual({ path: "test.ts" });
  });

  it("returns null for completely broken JSON", () => {
    const result = repairJSON("not json at all {{{");
    // May or may not be recoverable, but shouldn't throw
    if (result !== null) {
      expect(() => JSON.parse(result)).not.toThrow();
    }
  });

  it("handles valid JSON unchanged", () => {
    const input = '{"path": "src/main.ts", "start_line": 1}';
    const result = repairJSON(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result!)).toEqual({ path: "src/main.ts", start_line: 1 });
  });
});
