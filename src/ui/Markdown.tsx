import { Text } from "ink";
import chalk from "chalk";

interface MarkdownProps {
  content: string;
}

/**
 * Simple terminal Markdown renderer using chalk.
 * Handles: headers, code blocks, bold, inline code, lists.
 */
export function Markdown({ content }: MarkdownProps) {
  const rendered = renderMarkdown(content);
  return <Text>{rendered}</Text>;
}

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        result.push(chalk.dim("─".repeat(40)));
      } else {
        result.push(chalk.dim("─".repeat(40)));
      }
      continue;
    }

    if (inCodeBlock) {
      result.push(chalk.cyan(line));
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      result.push(chalk.bold(line.slice(4)));
      continue;
    }
    if (line.startsWith("## ")) {
      result.push(chalk.bold.underline(line.slice(3)));
      continue;
    }
    if (line.startsWith("# ")) {
      result.push(chalk.bold.underline(line.slice(2)));
      continue;
    }

    // Process inline formatting
    let processed = line;

    // Bold: **text**
    processed = processed.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text));

    // Inline code: `text`
    processed = processed.replace(/`(.*?)`/g, (_, text) => chalk.cyan(text));

    // List items
    if (processed.match(/^\s*[-*]\s/)) {
      processed = processed.replace(/^(\s*)[-*]\s/, "$1• ");
    }

    result.push(processed);
  }

  return result.join("\n");
}
