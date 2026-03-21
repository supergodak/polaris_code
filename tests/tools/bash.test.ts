import { describe, it, expect } from "bun:test";
import { bashTool } from "../../src/tools/bash.ts";

describe("bash", () => {
  it("executes simple command", async () => {
    const result = await bashTool.handler({ command: "echo hello" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("captures stderr on failure", async () => {
    const result = await bashTool.handler({ command: "ls /nonexistent_dir_xyz" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Exit code");
  });

  it("respects timeout", async () => {
    const result = await bashTool.handler({ command: "sleep 10", timeout: 500 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("returns no output message", async () => {
    const result = await bashTool.handler({ command: "true" });
    expect(result.success).toBe(true);
    expect(result.output).toBe("(no output)");
  });
});
