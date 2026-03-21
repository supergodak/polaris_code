export interface MemoryEntry {
  name: string;
  description: string;
  type: "user" | "project" | "feedback" | "reference";
  content: string;
  filePath: string;
  updatedAt: string; // ISO 8601
}

export interface MemoryStore {
  list(scope: "global" | "project"): Promise<MemoryEntry[]>;
  read(name: string): Promise<MemoryEntry | null>;
  write(entry: Omit<MemoryEntry, "filePath" | "updatedAt">, scope: "global" | "project"): Promise<void>;
  delete(name: string): Promise<boolean>;
  search(query: string): Promise<MemoryEntry[]>;
}
