import type { MemoryStore, MemoryEntry } from "./types.ts";

/**
 * Estimate token count from text using UTF-8 byte length / 4.
 */
export function estimateTokens(text: string): number {
  const byteLength = new TextEncoder().encode(text).length;
  return Math.ceil(byteLength / 4);
}

/**
 * Load relevant memories for system prompt injection at session start.
 * Returns formatted text for inclusion in the system prompt.
 */
export async function loadRelevantMemories(
  store: MemoryStore,
  maxTokens: number,
  userPrompt?: string,
): Promise<string> {
  const globalMemories = await store.list("global");
  const projectMemories = await store.list("project");

  const allMemories = [...projectMemories, ...globalMemories];

  if (allMemories.length === 0) return "";

  const sections: string[] = [];
  let currentTokens = 0;

  // Phase 1: Include all descriptions (lightweight index)
  const indexLines = allMemories.map(
    (m) => `- [${m.type}] ${m.name}: ${m.description}`,
  );
  const indexText = "## Available Memories\n" + indexLines.join("\n");
  const indexTokens = estimateTokens(indexText);

  if (indexTokens <= maxTokens) {
    sections.push(indexText);
    currentTokens += indexTokens;
  }

  // Phase 2: Include full content of user/feedback type memories (most useful)
  const priorityMemories = allMemories.filter(
    (m) => m.type === "user" || m.type === "feedback",
  );

  for (const mem of priorityMemories) {
    const text = formatMemory(mem);
    const tokens = estimateTokens(text);
    if (currentTokens + tokens <= maxTokens) {
      sections.push(text);
      currentTokens += tokens;
    }
  }

  // Phase 3: If user prompt provided, include matching project/reference memories
  if (userPrompt) {
    const keywords = userPrompt.toLowerCase()
      .replace(/[^\w\s\u3000-\u9fff]/g, "") // Remove punctuation
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const remaining = allMemories.filter(
      (m) =>
        m.type === "project" || m.type === "reference",
    );

    for (const mem of remaining) {
      const isRelevant = keywords.some(
        (kw) =>
          mem.name.toLowerCase().includes(kw) ||
          mem.description.toLowerCase().includes(kw),
      );

      if (isRelevant) {
        const text = formatMemory(mem);
        const tokens = estimateTokens(text);
        if (currentTokens + tokens <= maxTokens) {
          sections.push(text);
          currentTokens += tokens;
        }
      }
    }
  }

  return sections.join("\n\n");
}

function formatMemory(mem: MemoryEntry): string {
  return `### ${mem.name} (${mem.type})\n${mem.content}`;
}
