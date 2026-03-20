import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.ts";

export const createFileTask: EvalTask = {
  name: "create-file",
  prompt: "Create a file src/math.ts that exports an add(a: number, b: number): number function that returns the sum of a and b.",
  verify: async (workDir) => {
    const filePath = join(workDir, "src", "math.ts");

    if (!existsSync(filePath)) {
      return { pass: false, details: `File not found: ${filePath}` };
    }

    const content = readFileSync(filePath, "utf-8");

    if (!content.includes("export")) {
      return { pass: false, details: "Function is not exported" };
    }

    if (!content.includes("add")) {
      return { pass: false, details: "Function 'add' not found in file" };
    }

    if (!content.includes("number")) {
      return { pass: false, details: "Type annotations missing" };
    }

    // Basic syntax check: should parse as valid TS (no obvious errors)
    if (content.includes("syntax error") || content.includes("undefined")) {
      return { pass: false, details: "Content appears malformed" };
    }

    return { pass: true, details: `File created with ${content.split("\n").length} lines` };
  },
};
