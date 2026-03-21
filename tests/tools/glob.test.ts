import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { globTool } from "../../src/tools/glob.ts";

describe("glob", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "polaris-glob-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "main.ts"), "// main");
    writeFileSync(join(tmpDir, "src", "util.ts"), "// util");
    writeFileSync(join(tmpDir, "src", "style.css"), "/* css */");
    writeFileSync(join(tmpDir, "README.md"), "# readme");
  });

  afterAll(() => rmSync(tmpDir, { recursive: true }));

  it("finds files by pattern", async () => {
    const result = await globTool.handler({ pattern: "**/*.ts", cwd: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("main.ts");
    expect(result.output).toContain("util.ts");
    expect(result.output).not.toContain("style.css");
  });

  it("returns no matches message", async () => {
    const result = await globTool.handler({ pattern: "**/*.py", cwd: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("No files matching");
  });
});
