import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Message } from "../llm/types.ts";

const SESSIONS_DIR = join(homedir(), ".polaris", "sessions");

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  workDir: string;
  model: string;
  messages: Message[];
}

function ensureDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function generateId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

export function saveSession(messages: Message[], workDir: string, model: string, existingId?: string): string {
  ensureDir();
  const id = existingId || generateId();
  const now = new Date().toISOString();

  const data: SessionData = {
    id,
    createdAt: existingId ? loadSession(id)?.createdAt ?? now : now,
    updatedAt: now,
    workDir,
    model,
    messages,
  };

  writeFileSync(join(SESSIONS_DIR, `${id}.json`), JSON.stringify(data, null, 2), "utf-8");
  return id;
}

export function loadSession(id: string): SessionData | null {
  const filePath = join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SessionData;
}

export function loadLatestSession(workDir?: string): SessionData | null {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf-8")) as SessionData;
    if (!workDir || data.workDir === workDir) {
      return data;
    }
  }
  return null;
}

export function listSessions(limit = 10): SessionData[] {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map((file) =>
    JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf-8")) as SessionData,
  );
}
