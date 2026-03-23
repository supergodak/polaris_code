import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { validateStringArgs } from "./validate.ts";

const MAX_OUTPUT_LENGTH = 50_000;

export const readPdfTool: ToolDefinition = {
  name: "read_pdf",
  description:
    "Extract text content from a PDF file. Returns the full text or a specific page range. " +
    "Use this to read PDF documents, specifications, reports, etc.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the PDF file" },
      pages: {
        type: "string",
        description: "Page range to extract (e.g. '1-5', '3', '10-'). Default: all pages",
      },
    },
    required: ["path"],
  },
  permissionLevel: "auto",
  handler: async (args): Promise<ToolResult> => {
    const err = validateStringArgs(args, ["path"]);
    if (err) return err;

    const filePath = resolve(args.path as string);
    if (!existsSync(filePath)) {
      return { success: false, output: `File not found: ${filePath}`, error: "NOT_FOUND" };
    }

    if (!filePath.toLowerCase().endsWith(".pdf")) {
      return { success: false, output: `Not a PDF file: ${filePath}`, error: "NOT_PDF" };
    }

    const pages = args.pages as string | undefined;
    const cmdArgs = [filePath, "-"];
    if (pages) {
      // pdftotext uses -f (first) and -l (last) flags
      const match = pages.match(/^(\d+)(?:-(\d*))?$/);
      if (match) {
        cmdArgs.unshift("-f", match[1]!);
        if (match[2]) cmdArgs.splice(2, 0, "-l", match[2]);
      }
    }

    return new Promise((resolve) => {
      const child = spawn("pdftotext", cmdArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: string[] = [];
      const errChunks: string[] = [];

      child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString("utf-8")));
      child.stderr?.on("data", (d: Buffer) => errChunks.push(d.toString("utf-8")));

      child.on("close", (code) => {
        if (code !== 0) {
          const errMsg = errChunks.join("") || "pdftotext failed";
          resolve({ success: false, output: errMsg, error: `Exit code ${code}` });
          return;
        }

        let output = chunks.join("");
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(0, MAX_OUTPUT_LENGTH) +
            `\n\n[OUTPUT TRUNCATED: ${output.length} chars total, showing first ${MAX_OUTPUT_LENGTH}]`;
        }

        const lineCount = output.split("\n").length;
        resolve({
          success: true,
          output: output || "(empty PDF)",
        });
      });

      child.on("error", (e) => {
        resolve({
          success: false,
          output: `pdftotext not found. Install with: brew install poppler`,
          error: e.message,
        });
      });
    });
  },
};
