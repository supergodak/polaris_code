# Quickstart: Polaris Coding Agent

## Prerequisites

- macOS (Apple Silicon)
- Bun 1.x (`curl -fsSL https://bun.sh/install | bash`)
- Python 3.11+ + mlx-lm（推論サーバー用）
- コーディングモデルがダウンロード済み（例: Qwen2.5-Coder-32B-Instruct）

## Setup

```bash
# 1. 依存関係インストール
bun install

# 2. mlx_lm.serverを起動（別ターミナル）
python -m mlx_lm.server --model mlx-community/Qwen2.5-Coder-32B-Instruct-8bit

# 3. Polarisを起動（開発モード）
bun run src/index.tsx

# 3'. または、ビルドしてバイナリ実行
bun run build
./dist/polaris
```

## Usage

```
$ polaris
Polaris Coding Agent v0.1.0
Model: Qwen2.5-Coder-32B-Instruct (via mlx_lm.server)

> hello worldスクリプトを作成して

[thinking] ファイルを作成します...

--- write_file: src/hello.py ---
def hello():
    print("Hello, World!")

if __name__ == "__main__":
    hello()
---
承認しますか？ [y/n/always]:
```

## Configuration

`~/.polaris/config.json`:
```json
{
  "llm": {
    "apiBase": "http://localhost:8080/v1",
    "model": "mlx-community/Qwen2.5-Coder-32B-Instruct-8bit",
    "temperature": 0.1,
    "maxTokens": 4096
  },
  "agent": {
    "maxIterations": 25
  },
  "permissions": {
    "read_file": "auto",
    "glob": "auto",
    "grep": "auto",
    "write_file": "confirm",
    "edit_file": "confirm",
    "bash": "confirm"
  }
}
```

## Build

```bash
# 単一バイナリにコンパイル
bun build src/index.tsx --compile --outfile dist/polaris

# テスト実行
bun test
```
