# Tasks: AI-Driven Coding Agent CLI (v3)

**Input**: Design documents from `/specs/001-ai-coding-agent-core/`
**Prerequisites**: plan.md (v3), spec.md, research.md, data-model.md (v3), contracts/

## Phase 0: Git整理

- [ ] T000 未コミットのスペックファイルをコミット

**Checkpoint**: スペック全ファイルがGit管理下にあること

---

## Phase 0.5: プロンプト事前検証

**Purpose**: ターゲットモデルでツール呼び出しが安定するか検証し、プロンプト設計を固定

- [ ] T001 `scripts/validate-toolcall.ts` 作成 — 全ツール定義を含むリクエストをmlx_lm.serverに送信し、ツール呼び出しの正確性を検証
- [ ] T002 `src/agent/prompt.ts` 草案作成 — ツール説明テンプレート、few-shot例1つ、エラー時指示
- [ ] T003 検証実行 — 20回実行中17回以上（85%以上）ツール呼び出しが正しいことを確認

**Checkpoint**: ターゲットモデルで85%以上の成功率

---

## Phase 1: プロジェクト初期化

**Purpose**: Bunプロジェクトの骨格構築

- [ ] T004 `bun init` → package.json 編集（name, version, type, bin）
- [ ] T005 tsconfig.json 作成（strict, jsx=react-jsx, moduleResolution=bundler）
- [ ] T006 [P] 依存関係インストール: openai, ink, react, @types/react, zod, commander, chalk, marked, fast-glob, ink-spinner
- [ ] T007 [P] 開発依存関係: vitest, @testing-library/react, ink-testing-library, typescript, @types/node
- [ ] T008 plan.md v3のSource Code構造に従い src/ 配下のディレクトリとスタブファイルを作成
- [ ] T009 [P] tests/ 配下のディレクトリ構造を作成
- [ ] T010 [P] scripts/ ディレクトリを作成

**Checkpoint**: `bun run src/index.tsx` がエラーなく起動する骨格

---

## Phase 2: 基盤実装

**Purpose**: 全Phase前提となるコア基盤 + テスト基盤

### 型定義・設定

- [ ] T011 `src/config/types.ts` — PolarisConfig型（memory, logging含む）+ Zodスキーマ
- [ ] T012 `src/config/settings.ts` — 設定ファイル読み込み、デフォルト値、CLI引数オーバーライド
- [ ] T013 `src/llm/types.ts` — Message, ToolCall型（OpenAI SDK re-export + 独自型）
- [ ] T014 `src/tools/types.ts` — ToolDefinition, ToolResult（diagnostics含む）, ToolProvider
- [ ] T015 `src/agent/types.ts` — AgentState型
- [ ] T016 `src/memory/types.ts` — MemoryEntry, MemoryStore

### LLMクライアント

- [ ] T017 `src/llm/client.ts` — OpenAI SDK でmlx_lm.server接続、chat(messages, tools)
- [ ] T018 `src/llm/stream.ts` — AsyncIterableラップ、テキスト/tool_calls分離、**不完全チャンク検出・バッファリング**

### ツールレジストリ

- [ ] T019 `src/tools/index.ts` — ToolRegistry（ToolProviderインターフェース対応、register/get/all/toOpenAITools/initializeAll/shutdownAll）

### テレメトリ

- [ ] T020 `src/logging/logger.ts` — JSONL形式、全メッセージ・ツール入出力・エラー・所要時間・トークン使用量

### リアリスティックモックサーバー [v3新規]

- [ ] T021 `tests/llm/mock-server.ts` — Bun HTTPサーバーで5モード再現:
  - normal: 非ストリーミング一括返却
  - streaming: SSEでチャンク分割（tool_callsのJSON分割を含む）
  - malformed: 不正JSON混入（末尾カンマ、引用符不一致）
  - timeout: 指定秒後にコネクション切断
  - incomplete: tool_calls途中でストリーム終了

### テスト

- [ ] T022 `tests/llm/client.test.ts` — モックサーバー全5モードでの接続テスト
- [ ] T023 `tests/tools/registry.test.ts` — レジストリ登録・取得 + ToolProvider統合

**Checkpoint**: 全モードのモックサーバーテストがパス + ログ出力確認

---

## Phase 3: ツール + メモリ + エージェントループ

**Purpose**: 自律的タスク遂行の中核

### コアツール（並行可能）

- [ ] T024 [P] `src/tools/read-file.ts` — 500行制限、超過通知、UTF-8エラー検出
- [ ] T025 [P] `src/tools/write-file.ts` — fs.writeFile + mkdirSync(recursive)
- [ ] T026 [P] `src/tools/edit-file.ts` — 多段フォールバック（完全一致→トリミング→ファジー）+ 診断情報
- [ ] T027 [P] `src/tools/glob.ts` — fast-glob パターン検索
- [ ] T028 [P] `src/tools/grep.ts` — ripgrep + フォールバック、GrepMatch型で出力統一
- [ ] T029 [P] `src/tools/bash.ts` — child_process.exec + timeout(120s) + cwd
- [ ] T030 [P] `src/tools/ask-user.ts` — UserInteractionアダプター経由（TUI/Headless統一）
- [ ] T031 `src/tools/post-edit-verify.ts` — .ts→tsc, .json→JSON.parse, .py→ast.parse

### メモリ機能 [v3新規]

- [ ] T032 `src/memory/store.ts` — ファイルベースMemoryStore実装（CRUD + フロントマターパース）
- [ ] T033 `src/memory/loader.ts` — セッション開始時の自動読み込み（グローバル+プロジェクト、上限2000トークン概算）
- [ ] T034 `src/memory/tools.ts` — memory_read, memory_write, memory_list ツール定義

### ツールテスト（並行可能）

- [ ] T035 [P] `tests/tools/read-file.test.ts` — 正常系、行範囲、500行制限、バイナリ検出
- [ ] T036 [P] `tests/tools/write-file.test.ts` — 新規作成、ディレクトリ自動作成
- [ ] T037 [P] `tests/tools/edit-file.test.ts` — 完全一致、トリミング一致、ファジーマッチ、不可視文字、診断情報
- [ ] T038 [P] `tests/tools/glob.test.ts` — パターンマッチ、除外パターン
- [ ] T039 [P] `tests/tools/grep.test.ts` — ripgrepパスとフォールバックパスの両方を明示テスト
- [ ] T040 [P] `tests/tools/bash.test.ts` — 正常実行、タイムアウト、エラー
- [ ] T041 [P] `tests/memory/store.test.ts` — CRUD、フロントマター、グローバル/プロジェクト分離
- [ ] T042 [P] `tests/memory/loader.test.ts` — 自動読み込み、トークン上限、キーワードマッチ

### エージェントループ

- [ ] T043 `src/agent/prompt.ts` — ツール説明動的埋め込み、メモリ注入、few-shot、エラー時指示
- [ ] T044 `src/agent/loop.ts` — ReActループ本体（LLM→tool_calls→permission→実行→結果追加→再送信）
- [ ] T045 エラーリカバリー（loop.ts内）:
  - JSON不正 → 修復 → 具体的フィードバック
  - 存在しないツール → 候補提示
  - 3回連続失敗 → ユーザー報告
- [ ] T046 `src/agent/context-manager.ts` — トークン概算（UTF-8バイト長/4）、プルーニング（コピー操作）、上限12,000
- [ ] T047 パーミッション連携 — UserInteraction.requestPermission() コールバック

### エージェントテスト

- [ ] T048 `tests/agent/loop.test.ts` — モックサーバー（streaming/malformed）使用、単一ツール、連鎖、エラーリカバリー、maxIterations
- [ ] T049 `tests/agent/context-manager.test.ts` — プルーニング動作、日本語テキストでの概算妥当性

**Checkpoint**: ヘッドレスモードでツールチェーン実行成功 + メモリ保存/読み込み動作 + コンテキストプルーニング動作

---

## Phase 4: TUI - Ink コンポーネント

**Purpose**: Claude Code風のリッチなターミナルUI

- [ ] T050 `src/ui/theme.ts` — chalk ベースのカラーテーマ
- [ ] T051 `src/ui/Spinner.tsx` — 推論中インジケーター（ink-spinner）
- [ ] T052 `src/ui/Markdown.tsx` — marked + chalk ターミナルMarkdown
- [ ] T053 `src/ui/ToolCall.tsx` — ツール名・引数・結果 + 中間状態表示（実行中→完了→折りたたみ）
- [ ] T054 `src/ui/Permission.tsx` — 承認/拒否/常に許可 + diffプレビュー
- [ ] T055 `src/ui/Chat.tsx` — メッセージ一覧（user/assistant区別、スクロール）
- [ ] T056 `src/ui/Input.tsx` — テキスト入力 + スラッシュコマンド検出
- [ ] T057 `src/ui/App.tsx` — ルート（AgentState管理、レイアウト、ループ連携、メモリ表示）
- [ ] T058 [P] `tests/ui/App.test.tsx` — ink-testing-library UIテスト
- [ ] T059 [P] `tests/ui/Permission.test.tsx` — 許可制御テスト

**Checkpoint**: TUI上でエージェントとの対話成立 + ツール中間状態表示 + メモリ操作

---

## Phase 5: 統合・CLI・ビルド・評価

**Purpose**: 全モジュール統合と品質検証

### 統合

- [ ] T060 `src/index.tsx` — Commander.js CLIパース → 設定 → ヘルスチェック → メモリ読み込み → ToolRegistry初期化 → Ink App
- [ ] T061 mlx_lm.server接続チェック（GET /health）
- [ ] T062 スラッシュコマンド: /quit, /exit, /clear, /help, /memory

### ビルド

- [ ] T063 package.json scripts: dev, build, test
- [ ] T064 `bun build src/index.tsx --compile --outfile dist/polaris`

### 評価スイート [v3強化: 多数決方式]

- [ ] T065 `scripts/run-evals.ts` — ヘッドレス評価ランナー（--runs N, --model, プリフライトチェック統合）
- [ ] T066 [P] `tests/evals/tasks/create-file.ts` — ファイル作成 + TypeScript構文チェック
- [ ] T067 [P] `tests/evals/tasks/edit-existing.ts` — 既存ファイルの関数名変更
- [ ] T068 [P] `tests/evals/tasks/search-and-answer.ts` — 正しいファイルパス+行番号の回答
- [ ] T069 [P] `tests/evals/tasks/multi-step.ts` — ファイル作成 + bash実行の連鎖
- [ ] T070 [P] `tests/evals/tasks/error-recovery.ts` — 存在しないファイルからの回復
- [ ] T071 評価実行: 各タスク3回実行、2/3以上成功でパス

### 統合テスト

- [ ] T072 リアリスティックモックサーバー + 自動入力でE2Eテスト
- [ ] T073 quickstart.md の手順検証

**Checkpoint**: `dist/polaris` 単独起動 + 5評価タスク全パス（3回中2回以上） + メモリ永続化確認

---

## Dependencies & Execution Order

```
Phase 0   (Git)
  └──> Phase 0.5 (プロンプト検証)
         └──> Phase 1 (Setup)
                └──> Phase 2 (基盤 + モック) ── BLOCKS ALL ──┐
                       ├──> Phase 3 (ツール + メモリ + ループ)│
                       │                                     │
                       Phase 4 (TUI) ←── Phase 3 必須        │
                         └──> Phase 5 (統合 + 評価)           │
```

### Parallel Opportunities

- Phase 1: T006-T010 並行可能
- Phase 3: 全ツール実装（T024-T031）並行可能、全テスト（T035-T042）並行可能
- Phase 4: T050-T056 並行可能（T057 App.tsx は全コンポーネント後）
- Phase 5: 評価タスク（T066-T070）並行可能

### タスク数サマリー

| Phase | タスク数 | 新規(v3) |
|-------|---------|---------|
| 0     | 1       | 0       |
| 0.5   | 3       | 0       |
| 1     | 7       | 1       |
| 2     | 13      | 2 (モック) |
| 3     | 26      | 5 (メモリ) |
| 4     | 10      | 0       |
| 5     | 14      | 1 (多数決) |
| **合計** | **74** | **9** |
