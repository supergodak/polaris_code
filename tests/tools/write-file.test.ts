import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileTool } from "../../src/tools/write-file.ts";

describe("write_file", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "polaris-write-"));
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("creates a new file", async () => {
    const file = join(tmpDir, "new.txt");
    const result = await writeFileTool.handler({ path: file, content: "hello\nworld\n" });
    expect(result.success).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("hello\nworld\n");
  });

  it("creates parent directories", async () => {
    const file = join(tmpDir, "deep", "nested", "file.txt");
    const result = await writeFileTool.handler({ path: file, content: "deep" });
    expect(result.success).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("deep");
  });

  it("overwrites existing file", async () => {
    const file = join(tmpDir, "overwrite.txt");
    await writeFileTool.handler({ path: file, content: "original" });
    await writeFileTool.handler({ path: file, content: "updated" });
    expect(readFileSync(file, "utf-8")).toBe("updated");
  });
});
