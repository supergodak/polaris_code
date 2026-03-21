import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileMemoryStore } from "../../src/memory/store.ts";
import { loadRelevantMemories, estimateTokens } from "../../src/memory/loader.ts";

describe("loadRelevantMemories", () => {
  let store: FileMemoryStore;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "polaris-loader-"));
    store = new FileMemoryStore(join(base, "global"), join(base, "project"));
  });

  it("returns empty string when no memories", async () => {
    const result = await loadRelevantMemories(store, 2000);
    expect(result).toBe("");
  });

  it("includes user and feedback memories", async () => {
    await store.write({
      name: "user prefs",
      description: "coding preferences",
      type: "user",
      content: "Prefers functional style",
    }, "global");

    await store.write({
      name: "feedback item",
      description: "testing approach",
      type: "feedback",
      content: "Always write tests first",
    }, "project");

    const result = await loadRelevantMemories(store, 2000);
    expect(result).toContain("user prefs");
    expect(result).toContain("functional style");
    expect(result).toContain("feedback item");
  });

  it("respects token limit", async () => {
    // Write a large memory
    await store.write({
      name: "large memory",
      description: "large",
      type: "user",
      content: "X".repeat(10000),
    }, "global");

    const result = await loadRelevantMemories(store, 100);
    const tokens = estimateTokens(result);
    // Should be within limit (with some margin for index)
    expect(tokens).toBeLessThan(200); // Allow some overhead
  });

  it("includes relevant project memories based on user prompt", async () => {
    await store.write({
      name: "architecture",
      description: "project architecture and structure",
      type: "project",
      content: "Uses MVC pattern",
    }, "project");

    await store.write({
      name: "deployment",
      description: "deployment process",
      type: "reference",
      content: "Deploy via CI/CD",
    }, "project");

    const result = await loadRelevantMemories(store, 2000, "what is the architecture?");
    expect(result).toContain("architecture");
    expect(result).toContain("MVC pattern");
  });
});
