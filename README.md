# Polaris - Fully AI-Driven Coding Agent

Polaris is a terminal-based AI coding agent powered by local LLMs. Unlike pair-programming tools such as aider, Polaris is designed for **fully autonomous AI-driven development** — you describe what you want, and the agent reads, writes, and edits code on its own.

Think of it as an open-source, local-first alternative to Claude Code.

## Features

- **Autonomous agent loop** — ReAct-style reasoning with tool use (read, write, edit, grep, glob, bash)
- **Local LLM first** — Runs against any OpenAI-compatible API (mlx_lm.server, ollama, vLLM, llama.cpp, etc.)
- **Rich terminal UI** — Built with Ink (React for CLI) with streaming responses, tool call display, and real-time status
- **Permission system** — Configurable allow/confirm/deny per tool
- **Plan mode** — Read-only analysis mode (`/plan`) before making changes (`/do`)
- **Memory system** — Persistent project and global memory across sessions
- **Interrupt support** — Double-tap ESC to interrupt the agent mid-task

## Requirements

- [Bun](https://bun.sh) v1.1+
- An OpenAI-compatible LLM server (local or remote)

### Recommended Models

Polaris targets **32B–70B parameter class** models with strong instruction following and tool-use capabilities. Any model served via an OpenAI-compatible API will work.

**Tested with:**

| Model | Size | Server | Notes |
|-------|------|--------|-------|
| Qwen 2.5 Coder | 32B | mlx_lm.server | Good balance of speed and quality on Apple Silicon |
| Qwen 3 | 32B | mlx_lm.server | Strong reasoning with thinking mode support |
| DeepSeek Coder V2 | 16B/236B | vLLM, ollama | MoE architecture, efficient |
| Llama 3.1/3.3 | 70B | vLLM, ollama | Strong general-purpose coding |

> Smaller models (7B–14B) can run but may struggle with complex multi-step tool use.

## Quick Start

```bash
# Install dependencies
bun install

# Start your LLM server (example with mlx_lm)
mlx_lm.server --model mlx-community/Qwen2.5-Coder-32B-Instruct-4bit --port 8080

# Run Polaris
bun run dev
```

### Build standalone binary

```bash
bun run build
./dist/polaris
```

## Usage

```
$ polaris [OPTIONS] [INITIAL_PROMPT]

Options:
  --model <name>       Model name (default: from config)
  --base-url <url>     API base URL (default: http://localhost:8080/v1)
  --max-iterations <n> Max agent loop iterations (default: 30)
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/plan` | Switch to plan mode (read-only analysis) |
| `/do` | Switch to execution mode |
| `/memory` | List saved memories |
| `/clear` | Clear chat history |
| `/help` | Show available commands |
| `/quit` | Exit Polaris |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ESC ESC` | Interrupt the agent (double-tap within 300ms) |
| `Enter` | Submit input |
| `\` + `Enter` | Insert newline (multi-line input) |
| `Ctrl+U` | Clear input line |

## Configuration

Create `~/.polaris/config.json`:

```json
{
  "llm": {
    "baseUrl": "http://localhost:8080/v1",
    "model": "qwen2.5-coder-32b-instruct"
  },
  "agent": {
    "maxIterations": 30
  },
  "permissions": {
    "bash": "confirm",
    "write_file": "confirm",
    "read_file": "allow"
  }
}
```

## Architecture

```
src/
  index.tsx          # Entry point (Commander.js CLI + Ink render)
  agent/             # ReAct agent loop, prompt engineering, context management
  llm/               # OpenAI-compatible API client with streaming
  tools/             # Tool implementations (read_file, write_file, edit_file, grep, glob, bash)
  ui/                # Ink (React) terminal UI components
  config/            # Settings management with Zod validation
```

## Philosophy

- **AI-first, not AI-assisted** — The agent drives development; the human provides direction
- **Local and private** — Your code never leaves your machine (when using local models)
- **Model agnostic** — No vendor lock-in; bring your own model
- **Open source** — MIT licensed, community-driven

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
