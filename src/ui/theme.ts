import chalk from "chalk";

export const theme = {
  brand: chalk.hex("#7C5CFF"),
  user: chalk.cyan,
  assistant: chalk.white,
  tool: chalk.yellow,
  toolResult: chalk.gray,
  error: chalk.red,
  success: chalk.green,
  warning: chalk.yellow,
  dim: chalk.dim,
  bold: chalk.bold,
  header: chalk.hex("#7C5CFF").bold,
  separator: chalk.dim("─".repeat(60)),
};
