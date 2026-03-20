import type { ToolDefinition, ToolProvider } from "./types.ts";
import { toOpenAITool } from "./types.ts";
import type { ChatCompletionTool } from "../llm/types.ts";

export class ToolRegistry {
  private providers = new Map<string, ToolProvider>();
  private standaloneTools = new Map<string, ToolDefinition>();

  registerProvider(provider: ToolProvider): void {
    this.providers.set(provider.name, provider);
    for (const tool of provider.tools()) {
      this.standaloneTools.set(tool.name, tool);
    }
  }

  register(tool: ToolDefinition): void {
    this.standaloneTools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.standaloneTools.get(name);
  }

  all(): ToolDefinition[] {
    return Array.from(this.standaloneTools.values());
  }

  names(): string[] {
    return Array.from(this.standaloneTools.keys());
  }

  toOpenAITools(): ChatCompletionTool[] {
    return this.all().map(toOpenAITool);
  }

  async initializeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.initialize) {
        await provider.initialize();
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.shutdown) {
        await provider.shutdown();
      }
    }
  }

  /**
   * Find the closest tool name to the given input (for error recovery).
   */
  findClosest(name: string): string | null {
    const names = this.names();
    if (names.length === 0) return null;

    let bestName = names[0]!;
    let bestScore = 0;

    for (const n of names) {
      const score = similarity(name, n);
      if (score > bestScore) {
        bestScore = score;
        bestName = n;
      }
    }

    return bestScore > 0.3 ? bestName : null;
  }
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // Simple character overlap ratio
  let matches = 0;
  const longerLower = longer.toLowerCase();
  const shorterLower = shorter.toLowerCase();

  for (let i = 0; i < shorterLower.length; i++) {
    if (longerLower.includes(shorterLower[i]!)) {
      matches++;
    }
  }

  // Also check if one contains the other
  if (longerLower.includes(shorterLower) || shorterLower.includes(longerLower)) {
    return 0.8;
  }

  return matches / longer.length;
}
