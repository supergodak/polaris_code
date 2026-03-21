import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.ts";

export const editExistingTask: EvalTask = {
  name: "edit-existing",
  prompt: "In src/utils.ts, rename the function 'calculateTotal' to 'computeSum'.",

  setup: async (workDir) => {
    mkdirSync(join(workDir, "src"), { recursive: true });
    writeFileSync(
      join(workDir, "src", "utils.ts"),
      `export function calculateTotal(a: number, b: number): number {
  return a + b;
}

export function formatCurrency(amount: number): string {
  return \`$\${amount.toFixed(2)}\`;
}
`,
      "utf-8",
    );
  },

  verify: async (workDir) => {
    const filePath = join(workDir, "src", "utils.ts");

    if (!existsSync(filePath)) {
      return { pass: false, details: "File not found after edit" };
    }

    const content = readFileSync(filePath, "utf-8");

    if (content.includes("calculateTotal")) {
      return { pass: false, details: "Old function name 'calculateTotal' still exists" };
    }

    if (!content.includes("computeSum")) {
      return { pass: false, details: "New function name 'computeSum' not found" };
    }

    // formatCurrency should be untouched
    if (!content.includes("formatCurrency")) {
      return { pass: false, details: "Unrelated function 'formatCurrency' was removed" };
    }

    return { pass: true, details: "Function renamed correctly" };
  },
};
