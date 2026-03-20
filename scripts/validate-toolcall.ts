#!/usr/bin/env bun
/**
 * Validate that the target LLM model correctly generates tool calls
 * for the Polaris tool definitions.
 *
 * Usage:
 *   bun run scripts/validate-toolcall.ts [--runs N] [--api-base URL] [--model NAME]
 */
import OpenAI from "openai";
import { parseArgs } from "node:util";
import { ToolRegistry } from "../src/tools/index.ts";
import { readFileTool } from "../src/tools/read-file.ts";
import { writeFileTool } from "../src/tools/write-file.ts";
import { editFileTool } from "../src/tools/edit-file.ts";
import { globTool } from "../src/tools/glob.ts";
import { grepTool } from "../src/tools/grep.ts";
import { bashTool } from "../src/tools/bash.ts";
import { createAskUserTool, HeadlessInteraction } from "../src/tools/ask-user.ts";
import { createMemoryTools } from "../src/memory/tools.ts";
import { FileMemoryStore } from "../src/memory/store.ts";
import { toOpenAITool } from "../src/tools/types.ts";

const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "20" },
    "api-base": { type: "string", default: "http://localhost:8080/v1" },
    model: { type: "string", default: "default" },
  },
});

const TOTAL_RUNS = parseInt(args.runs!, 10);
const API_BASE = args["api-base"]!;
const MODEL = args.model!;

// --- Build tool definitions ---
const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(writeFileTool);
registry.register(editFileTool);
registry.register(globTool);
registry.register(grepTool);
registry.register(bashTool);
registry.register(createAskUserTool(new HeadlessInteraction()));
const memStore = new FileMemoryStore("/tmp/polaris-validate-global", "/tmp/polaris-validate-project");
for (const t of createMemoryTools(memStore)) registry.register(t);

const tools = registry.toOpenAITools();
const validToolNames = new Set(registry.names());

// --- Test scenarios ---
interface Scenario {
  name: string;
  userMessage: string;
  expectedTool: string;
  validateArgs?: (args: Record<string, unknown>) => boolean;
}

const scenarios: Scenario[] = [
  {
    name: "read_file call",
    userMessage: "Read the file src/main.ts",
    expectedTool: "read_file",
    validateArgs: (a) => typeof a.path === "string" && a.path.includes("main.ts"),
  },
  {
    name: "write_file call",
    userMessage: "Create a file called hello.py with a hello world function",
    expectedTool: "write_file",
    validateArgs: (a) => typeof a.path === "string" && typeof a.content === "string",
  },
  {
    name: "grep call",
    userMessage: "Search for 'TODO' in the project",
    expectedTool: "grep",
    validateArgs: (a) => typeof a.pattern === "string",
  },
  {
    name: "glob call",
    userMessage: "Find all TypeScript files in the project",
    expectedTool: "glob",
    validateArgs: (a) => typeof a.pattern === "string",
  },
  {
    name: "bash call",
    userMessage: "Run the tests with 'bun test'",
    expectedTool: "bash",
    validateArgs: (a) => typeof a.command === "string",
  },
];

// --- Validate ---
const client = new OpenAI({ baseURL: API_BASE, apiKey: "not-needed" });

// Health check
try {
  await fetch(API_BASE.replace(/\/v1\/?$/, "/health"));
} catch {
  console.error(`\x1b[31mError: Cannot connect to LLM server at ${API_BASE}\x1b[0m`);
  console.error("Make sure mlx_lm.server is running.");
  process.exit(1);
}

console.log(`\nValidating tool calls against ${API_BASE} (model: ${MODEL})`);
console.log(`Running ${TOTAL_RUNS} iterations across ${scenarios.length} scenarios\n`);

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

for (let run = 0; run < TOTAL_RUNS; run++) {
  const scenario = scenarios[run % scenarios.length]!;
  const runLabel = `Run ${run + 1}/${TOTAL_RUNS} [${scenario.name}]`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a coding agent. Use the provided tools to complete tasks." },
        { role: "user", content: scenario.userMessage },
      ],
      tools,
      temperature: 0.1,
      max_tokens: 512,
    });

    const choice = response.choices[0];
    let toolCalls = choice?.message?.tool_calls;

    // Fallback: parse tool calls from content (Qwen/Hermes XML format)
    if ((!toolCalls || toolCalls.length === 0) && choice?.message?.content) {
      const contentToolCalls = parseToolCallsFromText(choice.message.content);
      if (contentToolCalls.length > 0) {
        toolCalls = contentToolCalls;
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      totalFail++;
      const content = choice?.message?.content?.slice(0, 100) ?? "";
      const reason = `No tool call generated (got text: "${content}...")`;
      failures.push(`${runLabel}: ${reason}`);
      console.log(`  \x1b[31m✗\x1b[0m ${runLabel} — ${reason}`);
      continue;
    }

    const rawTc = toolCalls[0]! as { id?: string; type?: string; function: { name: string; arguments: string } };
    const tc = rawTc;
    let passed = true;
    let reason = "";

    // Check 1: Valid tool name
    if (!validToolNames.has(tc.function.name)) {
      passed = false;
      reason = `Invalid tool name: ${tc.function.name}`;
    }

    // Check 2: Valid JSON arguments
    if (passed) {
      try {
        JSON.parse(tc.function.arguments);
      } catch {
        passed = false;
        reason = `Invalid JSON arguments: ${tc.function.arguments.slice(0, 100)}`;
      }
    }

    // Check 3: Expected tool
    if (passed && tc.function.name !== scenario.expectedTool) {
      // Not a hard failure — the model might choose a valid alternative
      reason = `Expected ${scenario.expectedTool}, got ${tc.function.name} (acceptable)`;
    }

    // Check 4: Validate arguments if expected tool matches
    if (passed && tc.function.name === scenario.expectedTool && scenario.validateArgs) {
      const args = JSON.parse(tc.function.arguments);
      if (!scenario.validateArgs(args)) {
        passed = false;
        reason = `Argument validation failed: ${tc.function.arguments.slice(0, 100)}`;
      }
    }

    if (passed) {
      totalPass++;
      console.log(`  \x1b[32m✓\x1b[0m ${runLabel} — ${tc.function.name}(${tc.function.arguments.slice(0, 60)})`);
    } else {
      totalFail++;
      failures.push(`${runLabel}: ${reason}`);
      console.log(`  \x1b[31m✗\x1b[0m ${runLabel} — ${reason}`);
    }
  } catch (e) {
    totalFail++;
    const reason = `Request error: ${e instanceof Error ? e.message : String(e)}`;
    failures.push(`${runLabel}: ${reason}`);
    console.log(`  \x1b[31m✗\x1b[0m ${runLabel} — ${reason}`);
  }
}

// --- Summary ---
const rate = ((totalPass / TOTAL_RUNS) * 100).toFixed(1);
const threshold = 85;
const passed = totalPass / TOTAL_RUNS >= threshold / 100;

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${totalPass}/${TOTAL_RUNS} passed (${rate}%)`);
console.log(`Threshold: ${threshold}%`);
console.log(`Verdict: ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);

if (failures.length > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}

console.log();
process.exit(passed ? 0 : 1);

// --- Helper: reuse parseToolCallsFromContent from src/llm/stream.ts ---
import { parseToolCallsFromContent } from "../src/llm/stream.ts";

function parseToolCallsFromText(content: string) {
  return parseToolCallsFromContent(content);
}
