import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileMemoryStore } from "../../src/memory/store.ts";

describe("FileMemoryStore", () => {
  let globalDir: string;
  let projectDir: string;
  let store: FileMemoryStore;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "polaris-mem-"));
    globalDir = join(base, "global");
    projectDir = join(base, "project");
    store = new FileMemoryStore(globalDir, projectDir);
  });

  it("writes and reads a memory", async () => {
    await store.write({
      name: "test memory",
      description: "A test memory",
      type: "project",
      content: "Some content here",
    }, "project");

    const entry = await store.read("test memory");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("test memory");
    expect(entry!.description).toBe("A test memory");
    expect(entry!.content).toBe("Some content here");
  });

  it("lists memories by scope", async () => {
    await store.write({
      name: "global mem",
      description: "global",
      type: "user",
      content: "g",
    }, "global");

    await store.write({
      name: "project mem",
      description: "project",
      type: "project",
      content: "p",
    }, "project");

    const globalList = await store.list("global");
    expect(globalList).toHaveLength(1);
    expect(globalList[0]!.name).toBe("global mem");

    const projectList = await store.list("project");
    expect(projectList).toHaveLength(1);
    expect(projectList[0]!.name).toBe("project mem");
  });

  it("deletes a memory", async () => {
    await store.write({
      name: "to delete",
      description: "will be deleted",
      type: "feedback",
      content: "delete me",
    }, "project");

    const deleted = await store.delete("to delete");
    expect(deleted).toBe(true);

    const entry = await store.read("to delete");
    expect(entry).toBeNull();
  });

  it("searches memories", async () => {
    await store.write({
      name: "TypeScript config",
      description: "tsconfig settings",
      type: "project",
      content: "strict mode enabled",
    }, "project");

    const results = await store.search("typescript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe("TypeScript config");
  });

  it("updates MEMORY.md index", async () => {
    await store.write({
      name: "indexed",
      description: "should appear in index",
      type: "reference",
      content: "content",
    }, "project");

    const indexPath = join(projectDir, "MEMORY.md");
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, "utf-8");
    expect(index).toContain("indexed");
    expect(index).toContain("should appear in index");
  });
});
