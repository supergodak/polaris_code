import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { grepTool } from "../../src/tools/grep.ts";

describe("grep", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "polaris-grep-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "main.ts"), 'const hello = "world";\nconst foo = "bar";\n');
    writeFileSync(join(tmpDir, "src", "util.ts"), 'export function hello() {}\n');
  });

  afterAll(() => rmSync(tmpDir, { recursive: true }));

  it("finds matches", async () => {
    const result = await grepTool.handler({ pattern: "hello", path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.output).toContain("match");
  });

  it("returns no matches message", async () => {
    const result = await grepTool.handler({ pattern: "nonexistent_pattern_xyz", path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("No matches");
  });

  it("uses file:line:content format", async () => {
    const result = await grepTool.handler({ pattern: "foo", path: tmpDir });
    expect(result.success).toBe(true);
    // Output should contain file:line:content format
    expect(result.output).toMatch(/\w+\.ts:\d+:/);
  });
});
