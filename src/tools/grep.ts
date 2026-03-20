import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export const grepTool: ToolDefinition = {
  name: "grep",
  description:
    "Search file contents for a pattern (regex supported). Returns matching lines with file paths and line numbers. " +
    "Uses ripgrep if available, falls back to built-in search.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Search pattern (regex)" },
      path: { type: "string", description: "File or directory to search (default: current directory)" },
      include: { type: "string", description: "File glob to include (e.g., '*.ts')" },
    },
    required: ["pattern"],
  },
  permissionLevel: "auto",
  handler: async (args): Promise<ToolResult> => {
    const err = validateStringArgs(args, ["pattern"]);
    if (err) return err;
    const pattern = args.pattern as string;
    const searchPath = (args.path as string | undefined) ?? ".";
    const include = args.include as string | undefined;

    try {
      const matches = hasRipgrep()
        ? searchWithRipgrep(pattern, searchPath, include)
        : await searchWithBuiltin(pattern, searchPath, include);

      if (matches.length === 0) {
        return { success: true, output: `No matches found for pattern: ${pattern}` };
      }

      const output = formatMatches(matches);
      return {
        success: true,
        output: `Found ${matches.length} match(es):\n${output}`,
      };
    } catch (e) {
      return {
        success: false,
        output: "",
        error: `Search error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};

function formatMatches(matches: GrepMatch[]): string {
  return matches.map((m) => `${m.file}:${m.line}:${m.content}`).join("\n");
}

let _hasRipgrep: boolean | null = null;

function hasRipgrep(): boolean {
  if (_hasRipgrep !== null) return _hasRipgrep;
  try {
    execSync("rg --version", { stdio: "pipe" });
    _hasRipgrep = true;
  } catch {
    _hasRipgrep = false;
  }
  return _hasRipgrep;
}

function searchWithRipgrep(pattern: string, path: string, include?: string): GrepMatch[] {
  const args = ["rg", "--json", "--max-count", "100"];
  if (include) args.push("--glob", include);
  args.push("--", pattern, path);

  let output: string;
  try {
    output = execSync(args.join(" "), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e: unknown) {
    // rg exits with 1 when no matches found
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }

  const matches: GrepMatch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "match") {
        matches.push({
          file: parsed.data.path.text,
          line: parsed.data.line_number,
          content: parsed.data.lines.text.trimEnd(),
        });
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return matches;
}

async function searchWithBuiltin(pattern: string, path: string, include?: string): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern, "g");
  const matches: GrepMatch[] = [];

  // Get list of files
  const globPattern = include ?? "**/*";
  const files = await fg(globPattern, {
    cwd: path === "." ? process.cwd() : path,
    ignore: ["node_modules/**", ".git/**", "dist/**"],
    onlyFiles: true,
    absolute: false,
  });

  for (const file of files) {
    const fullPath = path === "." ? file : join(path, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      if (content.includes("\0")) continue; // Skip binary

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          matches.push({
            file: fullPath,
            line: i + 1,
            content: lines[i]!.trimEnd(),
          });
        }
        regex.lastIndex = 0; // Reset for next test
      }
    } catch {
      // Skip unreadable files
    }

    if (matches.length >= 100) break;
  }

  return matches;
}
