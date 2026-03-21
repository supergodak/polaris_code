# Polaris Coding Agent - Development Guidelines

## Project Overview

ローカルLLM（MLX）で動作する完全AI駆動のコーディングエージェントCLIツール。
Claude Code / Gemini CLI と同じ TypeScript + Ink (React for CLI) アーキテクチャを採用。

## Active Technologies

- TypeScript 5.x + Bun (runtime/bundler/test)
- Ink (React for CLI) + React (TUI)
- OpenAI Node.js SDK (LLM client → mlx_lm.server)
- Zod (validation), Commander.js (CLI), chalk (colors), marked (Markdown)
- vitest (testing), ink-testing-library (UI testing)

## Project Structure

```text
src/
  index.tsx          # Entry point
  agent/             # ReAct agent loop
  llm/               # OpenAI-compatible API client
  tools/             # Tool implementations (read_file, write_file, etc.)
  ui/                # Ink (React) components
  config/            # Settings management
tests/
  agent/
  llm/
  tools/
  ui/
specs/               # Spec Kit feature specs
```

## Commands

```bash
bun install          # Install dependencies
bun run src/index.tsx  # Run in dev mode
bun test             # Run tests
bun build src/index.tsx --compile --outfile dist/polaris  # Build binary
```

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Ink components in .tsx files
- Zod for runtime validation of configs and tool arguments
- OpenAI SDK types for message/tool_call structures

## Spec Kit

Feature specs are managed under `specs/` using GitHub Spec Kit.
See `.specify/memory/constitution.md` for project principles.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
