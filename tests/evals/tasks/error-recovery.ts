import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.ts";

export const errorRecoveryTask: EvalTask = {
  name: "error-recovery",
  prompt: "Read the file src/nonexistent.ts. If it doesn't exist, create it using write_file with a simple greeting function that says hello.",

  verify: async (workDir) => {
    // The agent should:
    // 1. Try to read src/nonexistent.ts → get "file not found" error
    // 2. Recover by creating the file

    const filePath = join(workDir, "src", "nonexistent.ts");

    if (!existsSync(filePath)) {
      return { pass: false, details: "Agent did not create the file after read failure" };
    }

    return { pass: true, details: "Agent recovered from read error and created the file" };
  },
};
