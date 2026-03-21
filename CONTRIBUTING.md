# Contributing to Polaris

Thank you for your interest in contributing to Polaris! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Git](https://git-scm.com/)

### Setup

```bash
git clone https://github.com/supergodak/polaris_code.git
cd polaris_code
bun install
```

### Running

```bash
# Development mode
bun run dev

# Run tests
bun test

# Build binary
bun run build
```

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/supergodak/polaris_code/issues) to avoid duplicates
2. Use the **Bug Report** issue template
3. Include: steps to reproduce, expected vs actual behavior, model/server info

### Suggesting Features

1. Open an issue using the **Feature Request** template
2. Describe the use case and why it matters
3. Discuss before implementing — this saves everyone time

### Submitting Code

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Ensure all tests pass:
   ```bash
   bun test
   ```
5. Ensure the build succeeds:
   ```bash
   bun run build
   ```
6. Commit with a clear message describing **why**, not just what
7. Push and open a Pull Request against `main`

## Code Style

- **TypeScript strict mode** — No `any` types without justification
- **React functional components** with hooks (Ink framework)
- **Zod** for runtime validation of configs and tool arguments
- Keep functions small and focused
- Prefer readability over cleverness

### File Organization

| Directory | Purpose |
|-----------|---------|
| `src/agent/` | Agent loop, prompt engineering, context management |
| `src/llm/` | LLM client (OpenAI-compatible API) |
| `src/tools/` | Tool implementations |
| `src/ui/` | Ink (React) terminal UI components |
| `src/config/` | Settings and configuration |
| `tests/` | Test files (mirrors `src/` structure) |

### Adding a New Tool

1. Create `src/tools/your-tool.ts` implementing the `ToolDefinition` interface
2. Register it in `src/tools/index.ts`
3. Add tests in `tests/tools/your-tool.test.ts`
4. Set an appropriate default permission level (`allow`, `confirm`, or `deny`)

## Testing

- Write tests for new functionality
- Run the full suite before submitting: `bun test`
- Tests use `vitest` and `ink-testing-library`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Update relevant documentation if behavior changes
- Add tests for new features
- Ensure CI passes (build + tests)
- Respond to review feedback promptly

## Design Principles

When contributing, keep these project principles in mind:

1. **AI-first** — Polaris is a fully autonomous agent, not a pair-programming tool
2. **Model agnostic** — Must work with any OpenAI-compatible API; never depend on a specific model's quirks
3. **Local-first** — Default to keeping everything on the user's machine
4. **Simplicity** — Avoid over-engineering; the minimum complexity for the current task

## Community

- Be respectful and constructive — see our [Code of Conduct](CODE_OF_CONDUCT.md)
- Ask questions in [GitHub Discussions](https://github.com/supergodak/polaris_code/discussions)
- Tag issues with `good first issue` for newcomer-friendly tasks

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
