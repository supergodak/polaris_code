import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileTool } from "../../src/tools/read-file.ts";

describe("read_file", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "polaris-test-"));
    writeFileSync(join(tmpDir, "small.txt"), "line1\nline2\nline3\n");
    writeFileSync(join(tmpDir, "large.txt"), Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n"));
    writeFileSync(join(tmpDir, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  });

  afterAll(() => rmSync(tmpDir, { recursive: true }));

  it("reads a small file with line numbers", async () => {
    const result = await readFileTool.handler({ path: join(tmpDir, "small.txt") });
    expect(result.success).toBe(true);
    expect(result.output).toContain("1 | line1");
    expect(result.output).toContain("2 | line2");
  });

  it("truncates at 500 lines by default", async () => {
    const result = await readFileTool.handler({ path: join(tmpDir, "large.txt") });
    expect(result.success).toBe(true);
    expect(result.output).toContain("[NOTE: File has");
    expect(result.output).toContain("start_line=");
  });

  it("reads specific line range", async () => {
    const result = await readFileTool.handler({
      path: join(tmpDir, "large.txt"),
      start_line: 10,
      end_line: 15,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("10 | line 10");
    expect(result.output).toContain("15 | line 15");
    expect(result.output).not.toContain("16 | ");
  });

  it("returns error for nonexistent file", async () => {
    const result = await readFileTool.handler({ path: join(tmpDir, "nope.txt") });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("detects binary files", async () => {
    const result = await readFileTool.handler({ path: join(tmpDir, "binary.bin") });
    expect(result.success).toBe(false);
    expect(result.error).toContain("inary");
  });
});
