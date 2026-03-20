# Research: AI-Driven Coding Agent CLI

**Date**: 2026-03-20 (Updated: TypeScript + Ink 移行)

## R-001: LLM推論バックエンドの選定

**Decision**: `mlx_lm.server` をプライマリバックエンドとして採用し、OpenAI互換APIプロトコルで通信する

**Rationale**:
- mlx_lm.server v0.31.1がOpenAI互換API（`/v1/chat/completions`）を内蔵
- ツールコーリング（function calling）をネイティブサポート（Hermes形式の自動パース→OpenAI形式変換）
- ストリーミング、プロンプトキャッシュ、speculative decodingも対応
- エージェント側はOpenAI Node.js SDKの標準クライアントで接続可能
- UIの言語（TypeScript）とLLMサーバーの言語（Python/MLX）はHTTP APIで分離

**Alternatives considered**:
- llama.cpp server: 高性能だが、Apple Silicon最適化はMLXが優位
- Ollama: 便利だがレイヤーが増える。mlx_lm.serverで直接接続する方がシンプル

## R-002: モデル選定

**Decision**: Qwen3-Coder系をプライマリモデルとし、設定で切り替え可能にする

**Rationale**:
- Qwen3-Coder-Next 6bit（約60GB）: 128GB環境で長コンテキスト処理にも余裕
- Qwen3-Coder-30B-A3B 8bit: MoEアーキテクチャで高速、メモリ効率も良好
- Qwen2.5-Coder-32B-Instruct 8bit（約32GB）: 実績豊富、安定
- 全てHermes形式ツールコーリング対応、mlx_lm.serverとの互換性確認済み

**Alternatives considered**:
- CodeLlama-70B: 4bit量子化が必要、Qwen3系の方がコーディングベンチマークで優位
- DeepSeek-Coder-V2: MLXでの動作実績が限定的

## R-003: エージェントアーキテクチャ

**Decision**: OpenAI互換APIクライアント（Node.js SDK）+ 自前ReActエージェントループ

**Rationale**:
- mlx_lm.serverがOpenAI互換APIを提供するため、openai Node.js SDKで接続
- ツールコーリングのレスポンスをそのままパースし、対応ツール関数にディスパッチ
- 既存フレームワーク（LangChain等）は不要。ループ自体は単純で、依存を増やす価値がない

**Alternatives considered**:
- Vercel AI SDK: 便利だがWeb寄り、CLIには過剰
- LangChain.js: 過剰な抽象化、依存が重い

## R-004: TUIフレームワーク

**Decision**: Ink (React for CLI) を採用

**Rationale**:
- Claude Code、Gemini CLIが同一スタックを採用 → 実績が最も豊富
- React的な宣言的UIモデル → AI（Claude Code）が生成・保守しやすい
- Yoga (Flexbox) によるレイアウトエンジン → 複雑なTUIを宣言的に記述可能
- Markdownレンダリング（marked + highlight.js）の統合が容易
- Bun compileで単一バイナリにコンパイル可能

**Alternatives considered**:
- Textual (Python): 表現力高いがPythonに縛られる
- ratatui (Rust): パフォーマンスは最高だが開発コストが高い
- blessed/blessed-contrib: メンテナンスが停滞

## R-005: ランタイム・ビルドツール

**Decision**: Bunを採用（開発・テスト・ビルド・配布の全てに使用）

**Rationale**:
- TypeScriptをトランスパイルなしで直接実行可能
- `bun compile`で単一ネイティブバイナリを生成（Claude Codeと同じ配布方式）
- テストランナー内蔵（vitest互換API）
- パッケージインストールがnpmの10倍以上高速
- Node.js完全互換

**Alternatives considered**:
- Node.js + tsc + esbuild: ツールチェーンが複雑
- Deno: npm互換性にまだ課題

## R-006: ツールコーリングのエラーハンドリング

**Decision**: 3段階リトライ + フォールバック戦略

**Rationale**:
- Step 1: JSON構文エラー → 正規表現で修復を試みる（末尾カンマ、クォート不一致等）
- Step 2: 修復失敗 → LLMに「ツール呼び出しのJSON形式が不正でした」とフィードバックし再生成
- Step 3: 3回失敗 → ユーザーに状況を報告し、手動介入を求める

**Alternatives considered**:
- Structured generation: mlx_lm.serverでのサポートが限定的
- 常にリトライ: 無限ループリスクがある

## R-007: 先行プロジェクト分析

**Decision**: Claude Code / Gemini CLIのアーキテクチャを参考に、独自実装する

**Findings**:
- Claude Code: TypeScript + Ink + Bun compile、minified単一バンドル、ripgrep vendored
- Gemini CLI: TypeScript + Ink、モノレポ（cli/core/sdk分離）、OSS (Apache 2.0)
- Codex CLI: Rust + ratatui（元TSから移行）、サンドボックス重視
- Goose: Rust + cliclack、MCP中核
- aider: Python + prompt-toolkit + Rich、tree-sitter活用
- mlx-code: Python、最小構成のMLXコーディングエージェント

**Architecture Decision**:
Gemini CLIのモノレポ構造（cli/core分離）は参考になるが、初期フェーズでは過剰。単一パッケージから始め、必要に応じて分離する。
