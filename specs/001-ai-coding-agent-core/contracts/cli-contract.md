# CLI Contract: Polaris Coding Agent

## Command Interface

### 起動
```
polaris [OPTIONS] [INITIAL_PROMPT]
```

**Options**:
- `--model <MODEL>`: 使用するモデル名（設定ファイルを上書き）
- `--api-base <URL>`: mlx_lm.serverのURL（デフォルト: http://localhost:8080/v1）
- `--max-iterations <N>`: エージェントループ最大反復回数（デフォルト: 25）
- `--config <PATH>`: 設定ファイルパス
- `--version`: バージョン表示
- `--help`: ヘルプ表示

**INITIAL_PROMPT**: 起動時に即座に実行するプロンプト（省略時はインタラクティブモード）

### インタラクティブコマンド
- `/quit`, `/exit`: 終了
- `/model <NAME>`: モデル切り替え（未実装の場合はメッセージで案内）
- `/clear`: 会話履歴クリア
- `/help`: コマンド一覧表示

## Tool Call Protocol

mlx_lm.serverへのリクエストはOpenAI互換形式:

### リクエスト
```json
{
  "model": "model-name",
  "messages": [...],
  "tools": [...],
  "temperature": 0.1,
  "max_tokens": 4096,
  "stream": true
}
```

### ツール定義（tools配列の要素）
```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "Read the contents of a file at the given path",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "File path to read" },
        "start_line": { "type": "integer", "description": "Start line number (1-based, optional)" },
        "end_line": { "type": "integer", "description": "End line number (inclusive, optional)" }
      },
      "required": ["path"]
    }
  }
}
```

### レスポンス（ツール呼び出し時）
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "read_file",
          "arguments": "{\"path\": \"src/main.py\"}"
        }
      }]
    }
  }]
}
```

## Tool Definitions Summary

| Tool | Permission | Description |
|------|------------|-------------|
| `read_file` | auto | Read file contents with optional line range |
| `write_file` | confirm | Create or overwrite a file |
| `edit_file` | confirm | Replace a string in an existing file |
| `glob` | auto | Search for files matching a glob pattern |
| `grep` | auto | Search file contents using ripgrep |
| `bash` | confirm | Execute a shell command |
| `ask_user` | auto | Ask the user a clarifying question |

## Exit Codes

- `0`: 正常終了
- `1`: 一般的なエラー
- `2`: 設定エラー（設定ファイル不正、モデル未指定等）
- `3`: 接続エラー（mlx_lm.serverに接続不可）
