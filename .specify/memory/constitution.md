# Polaris Coding Agent Constitution

## Core Principles

### I. AI-First, Human-Directs
人間はコードを書かない。人間は意図・要件・フィードバックを伝え、AIが探索・設計・実装・検証を全て自律的に行う。人間はdiffの承認と方向性の指示のみ。

### II. Local-First
全てのLLM推論はローカルマシン（M5 Max 128GB）上で実行する。外部APIへの依存は排除する。MLXをプライマリ推論エンジンとし、32B〜70Bクラスのコーディング特化モデルを使用する。

### III. Tool-Driven Agent Loop
エージェントはReAct（Reasoning + Acting）パターンで動作する。思考→ツール実行→観察のループを自律的に回し、タスク完了まで自走する。ツールセットはシンプルに保ち、必要最小限から始める。

### IV. Backend-Agnostic
LLMバックエンドは差し替え可能な抽象化レイヤーを持つ。MLX, llama.cpp, OpenAI互換APIなど、複数のバックエンドに対応できる設計とする。

### V. Permission-Gated Execution
破壊的操作（ファイル削除、git push、外部通信等）は必ず人間の承認を得てから実行する。読み取り系操作は自動許可。

### VI. Simplicity Over Completeness
機能は必要になった時に追加する（YAGNI）。Claude Codeの全機能を再現するのではなく、コーディングエージェントとして実用的な最小限から始める。

## Technology Stack

- **言語**: TypeScript 5.x
- **ランタイム**: Bun（開発・ビルド・テスト・バイナリコンパイル）
- **TUI**: Ink (React for CLI)
- **LLM推論サーバー**: mlx-lm（プライマリ）、OpenAI互換API（セカンダリ）
- **APIクライアント**: openai (Node.js SDK)
- **テスト**: vitest
- **対象モデル**: Qwen3-Coder系, Qwen2.5-Coder-32B, DeepSeek-Coder等

## Development Workflow

- Spec-Driven Development (GitHub Spec Kit) に従う
- テストは実装と同時に書く
- 各フェーズでレビューゲートを設ける
- Claude Code による完全AI駆動開発

## Governance

本Constitutionはプロジェクトの全ての設計判断の基盤となる。変更には明示的な議論と承認を要する。

**Version**: 2.0.0 | **Ratified**: 2026-03-20 | **Last Amended**: 2026-03-20
