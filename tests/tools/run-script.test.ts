import { describe, it, expect } from "bun:test";
import { runScriptTool } from "../../src/tools/run-script.ts";
import { existsSync } from "node:fs";

describe("run_script", () => {
  it("runs a python script and returns output", async () => {
    const result = await runScriptTool.handler({
      code: 'print("hello from python")',
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello from python");
  });

  it("runs a node script and returns output", async () => {
    const result = await runScriptTool.handler({
      code: 'console.log("hello from node")',
      language: "node",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello from node");
  });

  it("runs a bash script and returns output", async () => {
    const result = await runScriptTool.handler({
      code: 'echo "hello from bash"',
      language: "bash",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello from bash");
  });

  it("auto-detects python", async () => {
    const result = await runScriptTool.handler({
      code: 'import sys\nprint(sys.version_info.major)',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("3");
  });

  it("cleans up temp file after execution", async () => {
    await runScriptTool.handler({
      code: 'print("temp")',
      language: "python",
    });
    // All files in /tmp/polaris-scratch/ should be cleaned
    const scratchFiles = existsSync("/tmp/polaris-scratch")
      ? require("node:fs").readdirSync("/tmp/polaris-scratch")
      : [];
    // May have other files but this script's file should be gone
    expect(scratchFiles.filter((f: string) => f.startsWith("script-")).length).toBe(0);
  });

  it("reports errors from failing scripts", async () => {
    const result = await runScriptTool.handler({
      code: 'raise ValueError("test error")',
      language: "python",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("ValueError");
  });

  it("validates required args", async () => {
    const result = await runScriptTool.handler({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required");
  });
});
