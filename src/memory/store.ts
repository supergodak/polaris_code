import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { MemoryEntry, MemoryStore } from "./types.ts";

/**
 * File-based memory store using Markdown files with YAML frontmatter.
 */
export class FileMemoryStore implements MemoryStore {
  constructor(
    private globalDir: string,
    private projectDir: string,
  ) {
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  }

  async list(scope: "global" | "project"): Promise<MemoryEntry[]> {
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    return this.readDir(dir);
  }

  async read(name: string): Promise<MemoryEntry | null> {
    // Search both scopes, project first
    for (const dir of [this.projectDir, this.globalDir]) {
      const entries = this.readDir(dir);
      const entry = entries.find((e) => e.name === name);
      if (entry) return entry;
    }
    return null;
  }

  async write(
    entry: Omit<MemoryEntry, "filePath" | "updatedAt">,
    scope: "global" | "project",
  ): Promise<void> {
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    const fileName = toFileName(entry.name);
    const filePath = join(dir, fileName);

    const frontmatter = [
      "---",
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `type: ${entry.type}`,
      "---",
      "",
      entry.content,
    ].join("\n");

    writeFileSync(filePath, frontmatter, "utf-8");

    // Update MEMORY.md index
    this.updateIndex(dir);
  }

  async delete(name: string): Promise<boolean> {
    for (const dir of [this.projectDir, this.globalDir]) {
      const entries = this.readDir(dir);
      const entry = entries.find((e) => e.name === name);
      if (entry) {
        unlinkSync(entry.filePath);
        this.updateIndex(dir);
        return true;
      }
    }
    return false;
  }

  async search(query: string): Promise<MemoryEntry[]> {
    const all = [
      ...this.readDir(this.globalDir),
      ...this.readDir(this.projectDir),
    ];

    const queryLower = query.toLowerCase();
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(queryLower) ||
        e.description.toLowerCase().includes(queryLower) ||
        e.content.toLowerCase().includes(queryLower),
    );
  }

  private readDir(dir: string): MemoryEntry[] {
    if (!existsSync(dir)) return [];

    const entries: MemoryEntry[] = [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const entry = parseMemoryFile(raw, filePath);
        if (entry) entries.push(entry);
      } catch {
        // Skip unparseable files
      }
    }

    return entries;
  }

  private updateIndex(dir: string): void {
    const entries = this.readDir(dir);
    const lines = ["# Memory Index", ""];

    for (const entry of entries) {
      const fileName = basename(entry.filePath);
      lines.push(`- [${fileName}](${fileName}) - ${entry.description}`);
    }

    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n") + "\n", "utf-8");
  }
}

function parseMemoryFile(raw: string, filePath: string): MemoryEntry | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1]!;
  const content = match[2]!.trim();

  const name = extractField(frontmatter, "name");
  const description = extractField(frontmatter, "description");
  const type = extractField(frontmatter, "type") as MemoryEntry["type"];

  if (!name || !description || !type) return null;

  const stat = Bun.file(filePath);
  return {
    name,
    description,
    type,
    content,
    filePath,
    updatedAt: new Date().toISOString(), // Use current time as approximation
  };
}

function extractField(frontmatter: string, field: string): string | null {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function toFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_\u3000-\u9fff\uff00-\uffef]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") + ".md"
  );
}
