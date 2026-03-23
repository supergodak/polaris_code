import type { ChildProcess } from "node:child_process";

/** Default maximum output characters before truncation */
export const MAX_OUTPUT_CHARS = 50_000;

/**
 * Kill a process and its entire process group.
 * Uses negative PID to kill the process group (POSIX).
 * Falls back to killing just the child if group kill fails.
 */
export function killProcessGroup(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Truncate output to a maximum length with a consistent message.
 */
export function truncateOutput(output: string, maxLength: number = MAX_OUTPUT_CHARS): string {
  if (output.length <= maxLength) return output;
  return output.slice(0, maxLength) +
    `\n\n[TRUNCATED: showing first ${maxLength} of ${output.length} chars]`;
}
