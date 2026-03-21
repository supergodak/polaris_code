// @ts-nocheck — ink-testing-library render overload types incompatible with React 19
import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { Permission } from "../../src/ui/Permission.tsx";

function renderPermission(props: { toolName: string; args: Record<string, unknown>; onResolve: (v: boolean) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (render as any)(
    <Permission toolName={props.toolName} args={props.args} onResolve={props.onResolve} />,
  ) as { lastFrame: () => string | undefined; stdin: { write: (s: string) => void } };
}

describe("Permission", () => {
  it("renders tool name and args", () => {
    const { lastFrame } = renderPermission({
      toolName: "write_file",
      args: { path: "test.txt", content: "hello" },
      onResolve: () => {},
    });

    const output = lastFrame()!;
    expect(output).toContain("Permission Required");
    expect(output).toContain("write_file");
    expect(output).toContain("test.txt");
  });

  it("calls onResolve(true) on 'y' input", () => {
    let resolved: boolean | null = null;
    const { stdin, lastFrame } = renderPermission({
      toolName: "bash",
      args: { command: "echo hi" },
      onResolve: (v) => { resolved = v; },
    });

    expect(lastFrame()!).toContain("Permission Required");
    stdin.write("y");
    expect(resolved).toBe(true);
  });

  it("calls onResolve(false) on 'n' input", () => {
    let resolved: boolean | null = null;
    const { stdin } = renderPermission({
      toolName: "bash",
      args: { command: "rm -rf /" },
      onResolve: (v) => { resolved = v; },
    });

    stdin.write("n");
    expect(resolved).toBe(false);
  });

  it("hides after resolution", async () => {
    const { stdin, lastFrame } = renderPermission({
      toolName: "edit_file",
      args: { path: "x.ts" },
      onResolve: () => {},
    });

    expect(lastFrame()!).toContain("Permission Required");
    stdin.write("y");
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()!).not.toContain("Permission Required");
  });
});
