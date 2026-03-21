import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

/**
 * Run a lightweight syntax check on a file after edit/write.
 * Returns warning string if errors found, null if clean.
 */
export function postEditVerify(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".json": {
        const content = readFileSync(filePath, "utf-8");
        JSON.parse(content);
        return null;
      }

      case ".ts":
      case ".tsx": {
        try {
          // Use execFileSync with args array to prevent shell injection
          execFileSync("tsc", ["--noEmit", "--pretty", "false", filePath], {
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return null;
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string };
          const output = (err.stdout ?? "") + (err.stderr ?? "");
          const firstError = output.split("\n").find((l) => l.includes("error"));
          return firstError ?? "TypeScript syntax error detected";
        }
      }

      case ".py": {
        try {
          // Use execFileSync with args array to prevent shell injection
          execFileSync("python3", ["-c", `import ast,sys; ast.parse(open(sys.argv[1]).read())`, filePath], {
            encoding: "utf-8",
            timeout: 5_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return null;
        } catch (e: unknown) {
          const err = e as { stderr?: string };
          return err.stderr?.split("\n")[0] ?? "Python syntax error detected";
        }
      }

      default:
        return null;
    }
  } catch {
    return null; // Don't block on verification failures
  }
}
