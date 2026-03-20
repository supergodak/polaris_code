import { describe, it, expect } from "bun:test";
import { pruneMessages } from "../../src/agent/context-manager.ts";
import { estimateTokens } from "../../src/memory/loader.ts";
import type { Message } from "../../src/llm/types.ts";

describe("estimateTokens", () => {
  it("estimates English text", () => {
    const tokens = estimateTokens("hello world");
    expect(tokens).toBeGreaterThan(1);
    expect(tokens).toBeLessThan(10);
  });

  it("estimates Japanese text higher than English", () => {
    // "こんにちは" = 15 UTF-8 bytes → ~4 tokens
    const jpTokens = estimateTokens("こんにちは");
    // "hello" = 5 UTF-8 bytes → ~2 tokens
    const enTokens = estimateTokens("hello");
    expect(jpTokens).toBeGreaterThan(enTokens);
  });

  it("handles mixed content", () => {
    const mixed = "Hello こんにちは World 世界";
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(20);
  });

  it("handles code", () => {
    const code = 'function add(a: number, b: number): number { return a + b; }';
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });
});

describe("pruneMessages", () => {
  function makeMessages(count: number): Message[] {
    const msgs: Message[] = [
      { role: "system", content: "System prompt" },
    ];

    for (let i = 0; i < count; i++) {
      msgs.push({ role: "user", content: `User message ${i}` });
      msgs.push({
        role: "assistant",
        content: "A".repeat(1000), // ~250 tokens each, above compression threshold
      });
    }

    return msgs;
  }

  it("returns copy when within budget", () => {
    const msgs: Message[] = [
      { role: "system", content: "Short" },
      { role: "user", content: "Hi" },
    ];
    const result = pruneMessages(msgs, 10000);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(msgs); // Should be a copy
  });

  it("compresses old messages when over budget", () => {
    const msgs = makeMessages(20); // Many long messages
    const result = pruneMessages(msgs, 500); // Very tight budget

    // Should have same number of messages but some compressed
    expect(result.length).toBe(msgs.length);

    // Old assistant messages should be compressed
    const oldAssistant = result.find(
      (m, i) => m.role === "assistant" && i < result.length - 6 && m.content?.startsWith("[Compressed"),
    );
    expect(oldAssistant).toBeDefined();
  });

  it("preserves system messages", () => {
    const msgs = makeMessages(20);
    const result = pruneMessages(msgs, 500);
    const system = result.find((m) => m.role === "system");
    expect(system?.content).toBe("System prompt");
  });

  it("preserves last 3 turns", () => {
    const msgs = makeMessages(20);
    const result = pruneMessages(msgs, 500);

    // Last 6 messages should not be compressed
    const tail = result.slice(-6);
    for (const msg of tail) {
      if (msg.role === "assistant") {
        expect(msg.content?.startsWith("[Compressed")).toBe(false);
      }
    }
  });

  it("compresses tool results", () => {
    const msgs: Message[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Read file" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: '{"path":"x"}' } }] },
      { role: "tool", content: "A".repeat(2000), tool_call_id: "1", name: "read_file" },
      // Padding to push the tool result out of protected tail
      { role: "user", content: "msg1" },
      { role: "assistant", content: "resp1" },
      { role: "user", content: "msg2" },
      { role: "assistant", content: "resp2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "resp3" },
    ];

    const result = pruneMessages(msgs, 300);
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("[Compressed");
  });
});
