#!/usr/bin/env bun
/**
 * Headless evaluation runner for Polaris Coding Agent.
 * Runs eval tasks against a live LLM server, with majority-vote scoring.
 *
 * Usage:
 *   bun run scripts/run-evals.ts [--runs N] [--api-base URL] [--model NAME]
 */
import { parseArgs } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LLMClient } from "../src/llm/client.ts";
import { ToolRegistry } from "../src/tools/index.ts";
import { AgentLoop } from "../src/agent/loop.ts";
import { NullLogger } from "../src/logging/logger.ts";
import { HeadlessInteraction } from "../src/tools/ask-user.ts";
import { readFileTool } from "../src/tools/read-file.ts";
import { writeFileTool } from "../src/tools/write-file.ts";
import { editFileTool } from "../src/tools/edit-file.ts";
import { globTool } from "../src/tools/glob.ts";
import { grepTool } from "../src/tools/grep.ts";
import { bashTool } from "../src/tools/bash.ts";
import { createAskUserTool } from "../src/tools/ask-user.ts";
import { createMemoryTools } from "../src/memory/tools.ts";
import { FileMemoryStore } from "../src/memory/store.ts";
import type { EvalTask, EvalResult } from "../tests/evals/types.ts";
import { createFileTask } from "../tests/evals/tasks/create-file.ts";
import { editExistingTask } from "../tests/evals/tasks/edit-existing.ts";
import { searchAndAnswerTask, verifySearchResponse } from "../tests/evals/tasks/search-and-answer.ts";
import { multiStepTask } from "../tests/evals/tasks/multi-step.ts";
import { errorRecoveryTask } from "../tests/evals/tasks/error-recovery.ts";

const { values: opts } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    "api-base": { type: "string", default: "http://localhost:8080/v1" },
    model: { type: "string", default: "default" },
  },
});

const RUNS_PER_TASK = parseInt(opts.runs!, 10);
const API_BASE = opts["api-base"]!;
const MODEL = opts.model!;

const ALL_TASKS: EvalTask[] = [
  createFileTask,
  editExistingTask,
  searchAndAnswerTask,
  multiStepTask,
  errorRecoveryTask,
];

// --- Health check ---
const client = new LLMClient({ apiBase: API_BASE, model: MODEL, temperature: 0.1, maxTokens: 4096 });
const healthy = await client.healthCheck();
if (!healthy) {
  console.error(`\x1b[31mError: Cannot connect to LLM server at ${API_BASE}\x1b[0m`);
  process.exit(1);
}

console.log(`\nPolaris Eval Runner`);
console.log(`Model: ${MODEL} | Server: ${API_BASE} | Runs per task: ${RUNS_PER_TASK}\n`);

// --- Run evals ---
interface TaskScore {
  name: string;
  passed: number;
  total: number;
  details: string[];
}

const scores: TaskScore[] = [];
const startTime = Date.now();

for (const task of ALL_TASKS) {
  const score: TaskScore = { name: task.name, passed: 0, total: RUNS_PER_TASK, details: [] };
  process.stdout.write(`  ${task.name}: `);

  for (let run = 0; run < RUNS_PER_TASK; run++) {
    // Create isolated temp directory per run
    const workDir = mkdtempSync(join(tmpdir(), `polaris-eval-${task.name}-`));

    try {
      // Setup
      if (task.setup) {
        await task.setup(workDir);
      }

      // Build agent
      const registry = new ToolRegistry();
      const interaction = new HeadlessInteraction();
      registry.register(readFileTool);
      registry.register(writeFileTool);
      registry.register(editFileTool);
      registry.register(globTool);
      registry.register(grepTool);
      registry.register(bashTool);
      registry.register(createAskUserTool(interaction));
      const memStore = new FileMemoryStore(join(workDir, ".mem-global"), join(workDir, ".mem-project"));
      for (const t of createMemoryTools(memStore)) registry.register(t);

      const loop = new AgentLoop(
        new LLMClient({ apiBase: API_BASE, model: MODEL, temperature: 0.1, maxTokens: 4096 }),
        registry,
        interaction,
        new NullLogger(),
        { maxIterations: 15, maxContextTokens: 12000, workDir },
      );

      // Change to workDir for tool execution
      const origCwd = process.cwd();
      process.chdir(workDir);

      const response = await loop.run(task.prompt);

      process.chdir(origCwd);

      // Verify
      let result: EvalResult;
      if (task.name === "search-and-answer") {
        result = verifySearchResponse(response);
      } else {
        result = await task.verify(workDir);
      }

      if (result.pass) {
        score.passed++;
        process.stdout.write("\x1b[32m✓\x1b[0m");
      } else {
        score.details.push(`Run ${run + 1}: ${result.details}`);
        process.stdout.write("\x1b[31m✗\x1b[0m");
      }
    } catch (e) {
      score.details.push(`Run ${run + 1}: Error: ${e instanceof Error ? e.message : String(e)}`);
      process.stdout.write("\x1b[31m✗\x1b[0m");
    } finally {
      try { rmSync(workDir, { recursive: true }); } catch {}
    }
  }

  // Majority vote: pass if 2/3+ runs succeed
  const taskPassed = score.passed >= Math.ceil(RUNS_PER_TASK / 2);
  console.log(` ${score.passed}/${score.total} ${taskPassed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}`);

  scores.push(score);
}

// --- Summary ---
const duration = ((Date.now() - startTime) / 1000).toFixed(1);
const tasksPassedCount = scores.filter((s) => s.passed >= Math.ceil(RUNS_PER_TASK / 2)).length;

console.log(`\n${"─".repeat(60)}`);
console.log(`Overall: ${tasksPassedCount}/${ALL_TASKS.length} tasks passed`);
console.log(`Model: ${MODEL} | Runs: ${RUNS_PER_TASK} | Duration: ${duration}s`);

if (scores.some((s) => s.details.length > 0)) {
  console.log(`\nFailure details:`);
  for (const s of scores) {
    if (s.details.length > 0) {
      console.log(`  ${s.name}:`);
      for (const d of s.details) {
        console.log(`    - ${d}`);
      }
    }
  }
}

const allPassed = tasksPassedCount === ALL_TASKS.length;
console.log(`\nVerdict: ${allPassed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}\n`);
process.exit(allPassed ? 0 : 1);
