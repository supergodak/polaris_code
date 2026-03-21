import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.ts";

export const multiStepTask: EvalTask = {
  name: "multi-step",
  prompt: "Create a file src/hello.py with a hello() function that prints 'Hello, World!', then run it with python3 to verify it works.",

  verify: async (workDir) => {
    const filePath = join(workDir, "src", "hello.py");

    if (!existsSync(filePath)) {
      return { pass: false, details: "File src/hello.py not found" };
    }

    const content = readFileSync(filePath, "utf-8");

    if (!content.includes("def hello")) {
      return { pass: false, details: "Function 'hello' not found" };
    }

    if (!content.includes("Hello")) {
      return { pass: false, details: "Expected 'Hello' in function body" };
    }

    // The agent should have also run it with bash — we check that
    // by verifying the file is syntactically valid Python
    try {
      const { execSync } = await import("node:child_process");
      execSync(`python3 -c "import ast; ast.parse(open('${filePath}').read())"`, {
        timeout: 5000,
        stdio: "pipe",
      });
    } catch {
      return { pass: false, details: "Python syntax error in generated file" };
    }

    return { pass: true, details: "File created and Python syntax valid" };
  },
};
