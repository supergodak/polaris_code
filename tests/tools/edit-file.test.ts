import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { editFileTool } from "../../src/tools/edit-file.ts";

describe("edit_file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "polaris-edit-"));
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("performs exact match replacement", async () => {
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, 'const x = 1;\nconst y = 2;\n');

    const result = await editFileTool.handler({
      path: file,
      old_string: "const x = 1;",
      new_string: "const x = 42;",
    });

    expect(result.success).toBe(true);
    expect(readFileSync(file, "utf-8")).toContain("const x = 42;");
  });

  it("rejects ambiguous match (multiple occurrences)", async () => {
    const file = join(tmpDir, "dup.ts");
    writeFileSync(file, "foo\nfoo\n");

    const result = await editFileTool.handler({
      path: file,
      old_string: "foo",
      new_string: "bar",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Multiple matches");
  });

  it("falls back to trimmed match", async () => {
    const file = join(tmpDir, "trim.ts");
    writeFileSync(file, "  const x = 1;  \n  const y = 2;  \n");

    const result = await editFileTool.handler({
      path: file,
      old_string: "const x = 1;\nconst y = 2;",
      new_string: "const z = 3;",
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("trimmed match");
  });

  it("handles invisible characters in trimmed match", async () => {
    const file = join(tmpDir, "invis.ts");
    // File has NBSP and ZWSP
    writeFileSync(file, "const\u00A0x\u200B = 1;\n");

    const result = await editFileTool.handler({
      path: file,
      old_string: "const x = 1;",
      new_string: "const x = 2;",
    });

    expect(result.success).toBe(true);
  });

  it("returns clear error with re-read instruction on no match", async () => {
    const file = join(tmpDir, "fuzzy.ts");
    writeFileSync(file, "function hello() {\n  return 'world';\n}\n");

    const result = await editFileTool.handler({
      path: file,
      old_string: "function hello() {\n  return 'earth';\n}",
      new_string: "function hello() {\n  return 'mars';\n}",
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("MUST use read_file");
    expect(result.output).toContain("old_string not found");
  });

  it("returns EDIT_NOT_FOUND for completely different text", async () => {
    const file = join(tmpDir, "nope.ts");
    writeFileSync(file, "const x = 1;\n");

    const result = await editFileTool.handler({
      path: file,
      old_string: "completely different text that doesn't exist anywhere in the file at all",
      new_string: "replacement",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("EDIT_NOT_FOUND");
  });

  it("returns error for nonexistent file", async () => {
    const result = await editFileTool.handler({
      path: join(tmpDir, "nope.ts"),
      old_string: "x",
      new_string: "y",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
