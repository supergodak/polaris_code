import { describe, it, expect } from "bun:test";
import { ToolRegistry } from "../../src/tools/index.ts";
import type { ToolDefinition, ToolProvider, ToolResult } from "../../src/tools/types.ts";

function makeTool(name: string, permission: "auto" | "confirm" = "auto"): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: {}, required: [] },
    permissionLevel: permission,
    handler: async () => ({ success: true, output: `${name} executed` }),
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("test_tool");
    registry.register(tool);

    expect(registry.get("test_tool")).toBe(tool);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("tool_a"));
    registry.register(makeTool("tool_b"));
    registry.register(makeTool("tool_c"));

    const all = registry.all();
    expect(all).toHaveLength(3);
    expect(registry.names()).toEqual(["tool_a", "tool_b", "tool_c"]);
  });

  it("converts to OpenAI tools format", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("read_file"));

    const tools = registry.toOpenAITools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe("function");
    expect((tools[0] as { type: string; function: { name: string } }).function.name).toBe("read_file");
  });

  it("finds closest tool name", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("read_file"));
    registry.register(makeTool("write_file"));
    registry.register(makeTool("edit_file"));

    expect(registry.findClosest("readfile")).toBe("read_file");
    expect(registry.findClosest("read_fil")).toBe("read_file");
    expect(registry.findClosest("write")).toBe("write_file");
  });

  describe("ToolProvider", () => {
    it("registers provider and its tools", () => {
      const registry = new ToolRegistry();

      const provider: ToolProvider = {
        name: "test_provider",
        tools: () => [makeTool("provider_tool_a"), makeTool("provider_tool_b")],
      };

      registry.registerProvider(provider);

      expect(registry.get("provider_tool_a")).toBeDefined();
      expect(registry.get("provider_tool_b")).toBeDefined();
      expect(registry.all()).toHaveLength(2);
    });

    it("calls initialize and shutdown on providers", async () => {
      const registry = new ToolRegistry();
      let initialized = false;
      let shutdown = false;

      const provider: ToolProvider = {
        name: "lifecycle_provider",
        tools: () => [],
        initialize: async () => { initialized = true; },
        shutdown: async () => { shutdown = true; },
      };

      registry.registerProvider(provider);

      await registry.initializeAll();
      expect(initialized).toBe(true);

      await registry.shutdownAll();
      expect(shutdown).toBe(true);
    });

    it("mixes provider tools with standalone tools", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("standalone"));

      const provider: ToolProvider = {
        name: "mixed",
        tools: () => [makeTool("from_provider")],
      };
      registry.registerProvider(provider);

      expect(registry.all()).toHaveLength(2);
      expect(registry.names()).toContain("standalone");
      expect(registry.names()).toContain("from_provider");
    });
  });
});
