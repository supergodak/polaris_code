import { execSync } from "node:child_process";
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
        // Quick syntax check with tsc (no emit)
        try {
          execSync(`tsc --noEmit --pretty false "${filePath}" 2>&1`, {
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return null;
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string };
          const output = (err.stdout ?? "") + (err.stderr ?? "");
          // Extract first error line
          const firstError = output.split("\n").find((l) => l.includes("error"));
          return firstError ?? "TypeScript syntax error detected";
        }
      }

      case ".py": {
        try {
          execSync(
            `python3 -c "import ast; ast.parse(open('${filePath}').read())" 2>&1`,
            { encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] },
          );
          return null;
        } catch (e: unknown) {
          const err = e as { stderr?: string };
          return err.stderr?.split("\n")[0] ?? "Python syntax error detected";
        }
      }

      default:
        return null; // No check for unknown file types
    }
  } catch {
    return null; // Don't block on verification failures
  }
}
