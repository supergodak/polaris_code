# Implementation Plan: AI-Driven Coding Agent CLI (v3)

**Branch**: `001-ai-coding-agent-core` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)
**Revision**: v3 — 監査v2反映（テスト乖離対策・トークン概算修正・評価妥当性強化）+ メモリ機能 + MCP拡張設計

## Summary

ローカルLLM（MLX）で動作する完全AI駆動のコーディングエージェントCLIツールを構築する。TypeScript + Ink (React for CLI) で Claude Code / Gemini CLI と同じアーキテクチャを採用。mlx_lm.serverが提供するOpenAI互換APIにOpenAI Node.js SDKで接続し、ReActパターンのエージェントループでファイル操作・検索・bash実行を自律的に行う。Bun compileで単一バイナリとして配布。

**v3での主要変更点**:
1. [監査v2-7] テスト環境と本番環境の乖離対策 → リアリスティックモックサーバー導入
2. [監査v2-1] トークン概算の日本語対応 → UTF-8バイト長ベースに変更
3. [監査v2-6] 評価の統計的妥当性 → 多数決方式＋試行回数増加
4. [新規] メモリ機能 → セッション間の知識永続化（Claude Code同等）
5. [新規] MCP拡張設計 → ツールレジストリの拡張ポイント設計（実装はpost-MVP）

## Technical Context

**Language/Version**: TypeScript 5.x
**Runtime**: Bun 1.x（開発・テスト・ビルド・配布）
**Primary Dependencies**: openai (API client), ink + react (TUI), zod (validation), commander (CLI args), marked (Markdown), chalk (colors)
**Storage**: ローカルファイルシステム（設定はJSON、メモリはMarkdown）
**Testing**: vitest（Bun互換）
**Target Platform**: macOS (Apple Silicon)
**Project Type**: CLI tool
**Performance Goals**: 初回応答30秒以内、ツール実行は即時
**Constraints**: 全てローカル実行、外部API依存なし
**Scale/Scope**: シングルユーザー、単一プロジェクト対象

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. AI-First, Human-Directs | PASS | エージェントが自律実行、人間は指示と承認のみ |
| II. Local-First | PASS | mlx_lm.server + ローカルモデル、外部API依存なし |
| III. Tool-Driven Agent Loop | PASS | ReActパターン実装が中核 |
| IV. Backend-Agnostic | PASS | OpenAI互換APIプロトコルで抽象化 |
| V. Permission-Gated Execution | PASS | ツールごとのpermission_level設計 |
| VI. Simplicity Over Completeness | PASS | コアツール+メモリの最小構成から開始。MCP拡張は設計のみ |

## Project Structure

### Source Code

```text
src/
  index.tsx              # エントリーポイント（CLI解析 → Ink App起動）
  agent/
    loop.ts              # ReActエージェントループ
    prompt.ts            # システムプロンプト管理
    context-manager.ts   # コンテキスト窓管理・プルーニング
    types.ts             # AgentState, AgentConfig等の型定義
  llm/
    client.ts            # OpenAI互換APIクライアント
    types.ts             # Message, ToolCall型（OpenAI SDK re-export）
    stream.ts            # ストリーミングレスポンス処理
  tools/
    index.ts             # ツールレジストリ（内部ツール + 拡張ポイント）
    types.ts             # ToolDefinition, ToolResult型
    read-file.ts
    write-file.ts
    edit-file.ts         # 多段フォールバック + 診断情報
    glob.ts
    grep.ts
    bash.ts
    ask-user.ts
    post-edit-verify.ts  # 編集後自動構文チェック
  memory/                # メモリ機能
    types.ts             # MemoryEntry型
    store.ts             # ファイルベースのメモリ読み書き
    loader.ts            # セッション開始時の自動読み込み
    tools.ts             # memory_read, memory_write, memory_list ツール定義
  ui/
    App.tsx
    Chat.tsx
    Input.tsx
    ToolCall.tsx          # 中間状態表示対応
    Permission.tsx
    Markdown.tsx
    Spinner.tsx
    theme.ts
  config/
    settings.ts
    types.ts
  logging/
    logger.ts            # JSONL形式のセッションログ

scripts/
  validate-toolcall.ts   # プロンプト事前検証
  run-evals.ts           # ヘッドレス評価スイート

tests/
  agent/
    loop.test.ts
    context-manager.test.ts
  llm/
    client.test.ts
    mock-server.ts       # [v3新規] リアリスティックモックサーバー
  tools/
    registry.test.ts
    read-file.test.ts
    write-file.test.ts
    edit-file.test.ts
    glob.test.ts
    grep.test.ts
    bash.test.ts
  memory/
    store.test.ts
    loader.test.ts
  ui/
    App.test.tsx
    Permission.test.tsx
  evals/
    tasks/
      create-file.ts
      edit-existing.ts
      search-and-answer.ts
      multi-step.ts
      error-recovery.ts

package.json
tsconfig.json
bunfig.toml
```

---

## Phase 0: Git整理

- `git add specs/ CLAUDE.md .specify/`
- コミット: "Add spec documents for 001-ai-coding-agent-core"

---

## Phase 0.5: プロンプト・エンジニアリング事前検証

**目的**: ターゲットモデルでツール定義が正しく認識されるか検証し、プロンプト設計を固定する

### 0.5.1 検証スクリプト
- `scripts/validate-toolcall.ts`
- mlx_lm.serverに対して全ツール定義を含むリクエストを送信
- 検証項目: ツール名の正確性、arguments の有効なJSON、required パラメータ、連鎖呼び出し

### 0.5.2 プロンプトテンプレートの調整
- ツール定義descriptionをターゲットモデルが最も安定する記述に調整
- few-shot例は1例だけシステムプロンプトに固定（コンテキスト節約）

### 0.5.3 検証基準 [監査v2-6対応: 改訂]

旧: 5回連続成功
改訂: **20回実行中17回以上成功（85%以上）**

根拠: 成功率90%のモデルが5回連続成功する確率は59%。20回中17回以上なら、真の成功率80%未満を95%の信頼度で棄却できる。

### 0.5.4 成果物
- `scripts/validate-toolcall.ts`
- `src/agent/prompt.ts` 草案

---

## Phase 1: プロジェクト初期化

### 1.1 Bunプロジェクト初期化
- package.json: name "polaris", version "0.1.0", type "module"

### 1.2 TypeScript設定
- tsconfig.json: strict, jsx "react-jsx", moduleResolution "bundler"

### 1.3 依存関係
```bash
bun add openai ink react @types/react zod commander chalk marked fast-glob ink-spinner
bun add -d vitest @testing-library/react ink-testing-library typescript @types/node
```

### 1.4 ディレクトリ構造
```
src/{agent,llm,tools,memory,ui,config,logging}/
tests/{agent,llm,tools,memory,ui,evals/tasks}/
scripts/
```

### 検証
- `bun run src/index.tsx` がエラーなく起動（空コンポーネント）

---

## Phase 2: 基盤実装

### 2.1 型定義
- `src/config/types.ts` → PolarisConfig（Zodスキーマ）
- `src/llm/types.ts` → Message, ToolCall
- `src/tools/types.ts` → ToolDefinition, ToolResult（diagnostics含む）
- `src/agent/types.ts` → AgentState

### 2.2 設定管理
- `src/config/settings.ts`
- `~/.polaris/config.json` 読み込み、デフォルト値、CLI引数オーバーライド、Zodバリデーション

### 2.3 LLMクライアント
- `src/llm/client.ts` — OpenAI SDK で mlx_lm.server に接続
- `src/llm/stream.ts` — ストリーミング処理 + **不完全チャンク検出**

#### ストリーミングの堅牢性 [監査v2-4対応]
```typescript
// stream.ts の設計
// - tool_callsのJSON文字列が複数チャンクに分割される場合のバッファリング
// - ストリーム途中切断（max_tokens到達、ネットワーク断）の検出
// - 不完全なtool_call検出時: バッファ残りをフラッシュし、
//   エラーとしてagent loopに通知（"Incomplete tool call received"）
```

### 2.4 ツールレジストリ [MCP拡張対応: 設計変更]

- `src/tools/index.ts`

```typescript
interface ToolProvider {
  name: string;                                    // "builtin" | "mcp:serena" etc.
  tools(): ToolDefinition[];                       // 提供するツール一覧
  initialize?(): Promise<void>;                    // 起動時フック
  shutdown?(): Promise<void>;                      // 終了時フック
}

class ToolRegistry {
  private providers: Map<string, ToolProvider>;

  registerProvider(provider: ToolProvider): void;   // プロバイダー登録
  register(tool: ToolDefinition): void;            // 単体ツール登録（後方互換）
  get(name: string): ToolDefinition | undefined;
  all(): ToolDefinition[];
  toOpenAITools(): OpenAI.ChatCompletionTool[];

  async initializeAll(): Promise<void>;            // 全プロバイダー初期化
  async shutdownAll(): Promise<void>;              // 全プロバイダー終了
}
```

**設計意図**: MVPでは `BuiltinToolProvider`（7コアツール + メモリツール）のみ。
post-MVPで `MCPToolProvider` を追加する際、ToolRegistryの変更は不要。
LLMに渡すツール定義は `registry.toOpenAITools()` で統一的に生成される。

### 2.5 テレメトリ・ログ基盤
- `src/logging/logger.ts`
- `.polaris/logs/` にJSONLファイル出力
- 記録: 全メッセージ、ツール入出力、エラー履歴、所要時間、トークン使用量

### 2.6 リアリスティックモックサーバー [監査v2-7対応: 新規]

- `tests/llm/mock-server.ts`

**旧プランの問題**: モックLLMは固定レスポンスを一括返却するだけで、実際のmlx_lm.serverの振る舞い（ストリーミングチャンク分割、不正JSON混入、遅延）を再現しない。テストが全てパスしても本番では動かない「見せかけの品質」になるリスク。

**改訂**: BunのHTTPサーバーで以下を再現するモックサーバーを構築:

```typescript
// mock-server.ts の機能
interface MockServerConfig {
  mode: "normal" | "streaming" | "malformed" | "timeout" | "incomplete";
  responses: MockResponse[];        // シナリオ別の応答キュー
  chunkDelayMs?: number;            // チャンク間遅延（default: 10ms）
  malformedRate?: number;           // 不正JSON混入率（default: 0）
}

// モード説明:
// normal    — 非ストリーミング、一括レスポンス
// streaming — SSEで1トークンずつ返却（tool_callsのJSONが複数チャンクに分割される）
// malformed — tool_callsのargumentsに不正JSONを混入（末尾カンマ、引用符不一致）
// timeout   — 指定秒数後にコネクション切断
// incomplete — tool_callsの途中でストリーム終了（max_tokens到達シミュレーション）
```

**旧プランとの違い**: 固定レスポンスの「ハッピーパステスト」だけでなく、実運用で頻発する異常系をテスト段階で発見できる。Phase 0.5の手動検証を自動テストに昇格させる。

### 2.7 テスト
- `tests/llm/client.test.ts` → モックサーバー（streaming/malformed/timeout）での接続テスト
- `tests/tools/registry.test.ts` → レジストリ登録・取得 + ToolProvider統合テスト

### 検証
- 全モード（normal/streaming/malformed/timeout/incomplete）のモックサーバーテストがパス
- ログファイルが `.polaris/logs/` に正しく出力

---

## Phase 3: ツール + エージェントループ

### 3.1 コアツール実装（7つ、全て並行可能）

| ファイル | ツール | Permission | 実装内容 |
|---------|--------|------------|---------|
| `src/tools/read-file.ts` | read_file | auto | デフォルト500行制限、超過通知 |
| `src/tools/write-file.ts` | write_file | confirm | fs.writeFile + mkdirSync(recursive) |
| `src/tools/edit-file.ts` | edit_file | confirm | 多段フォールバック（後述3.1.2） |
| `src/tools/glob.ts` | glob | auto | fast-glob パターン検索 |
| `src/tools/grep.ts` | grep | auto | ripgrep子プロセス + フォールバック |
| `src/tools/bash.ts` | bash | confirm | child_process.exec + timeout(120s) |
| `src/tools/ask-user.ts` | ask_user | auto | UIアダプター経由（後述3.1.4） |

#### 3.1.1 read_file の読み取り制限
- デフォルト500行、設定で変更可能
- 超過時: `[NOTE: ファイルは全{totalLines}行です。行{start}-{end}を表示。続きはstart_lineを指定]`
- **エンコーディング対策** [監査v2-4対応]: UTF-8デコードエラー時は「バイナリファイルです。テキストとして読み取れません」を返却

#### 3.1.2 edit_file の多段フォールバック

```
1. 完全一致置換
2. 失敗 → トリミング一致（空白・改行正規化 + 不可視文字除去）
   - 除去対象: \u200B(ZWSP), \uFEFF(BOM), \u00A0(NBSP), \u200C, \u200D
3. 失敗 → ファジーマッチ（行単位の部分一致、類似度計算）
   - old_stringが50行以上の場合: 行単位diffベースのマッチに切り替え
     （レーベンシュタイン距離のO(n*m)コスト回避）
   - 50行未満: レーベンシュタイン距離で類似度計算
4. 結果に診断情報を含める（closest_match, similarity, line_range, hint）
```

#### 3.1.3 write_file / edit_file 後の自動検証
- `src/tools/post-edit-verify.ts`
- `.ts`/`.tsx` → `tsc --noEmit`, `.json` → JSON.parse, `.py` → `python -c "import ast; ..."`
- エラー時: ToolResult末尾に `[WARNING: 構文エラー: {message}]` を追記

#### 3.1.4 ask_user のアダプターパターン [監査v2-2対応]

```typescript
// ask_user の入出力を統一するインターフェース
interface UserInteraction {
  ask(question: string): Promise<string>;
  requestPermission(tool: string, args: unknown): Promise<boolean>;
}

// 実装は2つ:
class TUIInteraction implements UserInteraction { ... }      // Ink経由
class HeadlessInteraction implements UserInteraction { ... } // stdin/stdout

// ask_user ツールはこのインターフェース経由で動作するため、
// TUIモードとヘッドレスモード（eval）で同一のコードパスを通る
```

#### 3.1.5 grep の出力フォーマット統一 [監査v2-2対応]

```typescript
// ripgrep / フォールバック共通の出力型
interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

// ripgrep: `rg --json` でJSONL出力 → パース
// フォールバック: fs.readFile + RegExp → 同じGrepMatch形式で返却
// ToolResult.output には `{file}:{line}:{content}` 形式のテキストを生成
```

テスト時にripgrepの有無を明示的にチェックし、両パスをテストする。

### 3.2 メモリ機能 [v3新規]

**目的**: セッション間で永続する知識を保存・読み込みする。Claude Codeのメモリ機能と同等の体験を提供。

#### 3.2.1 設計思想

ローカルLLMはセッション間でコンテキストを失う。毎回「このプロジェクトはTypeScriptで…」と説明するのは非現実的。メモリ機能により:
- プロジェクトの構造・規約をセッション開始時に自動注入
- ユーザーの好み・作業スタイルを学習・保持
- 前回の作業の続きをスムーズに再開

#### 3.2.2 ストレージ設計

```
~/.polaris/memory/              # グローバルメモリ（ユーザー共通）
  user_preferences.md
  coding_style.md

{project}/.polaris/memory/      # プロジェクトメモリ（プロジェクト固有）
  MEMORY.md                     # メモリインデックス
  project_architecture.md
  current_tasks.md
```

- 形式: Markdownファイル（フロントマター付き）
- Claude Code準拠のフォーマット:
```markdown
---
name: プロジェクト構造
description: TypeScript+Ink構成のCLIツール
type: project
---
(内容)
```

#### 3.2.3 型定義

```typescript
// src/memory/types.ts
interface MemoryEntry {
  name: string;
  description: string;
  type: "user" | "project" | "feedback" | "reference";
  content: string;
  filePath: string;              // 実ファイルパス
  updatedAt: string;             // ISO 8601
}

interface MemoryStore {
  list(scope: "global" | "project"): Promise<MemoryEntry[]>;
  read(name: string): Promise<MemoryEntry | null>;
  write(entry: Omit<MemoryEntry, "filePath" | "updatedAt">): Promise<void>;
  delete(name: string): Promise<boolean>;
  search(query: string): Promise<MemoryEntry[]>;  // description全文検索
}
```

#### 3.2.4 セッション開始時の自動読み込み

```typescript
// src/memory/loader.ts
async function loadRelevantMemories(
  projectDir: string,
  userPrompt?: string
): Promise<string> {
  // 1. グローバルメモリの全エントリーを読み込み
  // 2. プロジェクトメモリの全エントリーを読み込み
  // 3. MEMORY.md（インデックス）があれば優先参照
  // 4. 全メモリの description を結合してシステムプロンプトに注入
  //    （content全文は注入しない — コンテキスト節約）
  // 5. ユーザーの初回プロンプトに関連するメモリがあれば、
  //    そのcontentも追加で注入（キーワードマッチ）

  // 注入テキスト上限: 2000トークン概算（コンテキスト圧迫防止）
}
```

#### 3.2.5 メモリツール（3つ）

| ツール | Permission | 用途 |
|--------|------------|------|
| `memory_read` | auto | 名前を指定してメモリを読み込み |
| `memory_write` | auto | メモリの新規作成・更新 |
| `memory_list` | auto | 全メモリの一覧表示 |

```typescript
// memory_write パラメータ
{
  name: string;           // メモリ名（ファイル名に使用）
  description: string;    // 1行の説明（検索・自動読み込みに使用）
  type: "user" | "project" | "feedback" | "reference";
  content: string;        // メモリ本文
  scope: "global" | "project";  // 保存先
}
```

**設計判断**: メモリツールのpermissionLevelは `auto`。理由:
- メモリ書き込みはユーザーの作業ディレクトリに閉じる（外部影響なし）
- 毎回承認を求めるとメモリ保存が面倒になり、使われなくなる
- Claude Codeも同様にautoで動作している

#### 3.2.6 コンテキスト窓への影響

メモリ注入分はコンテキスト管理の「保護対象」に含める:
- systemプロンプト + メモリ注入分 → プルーニング対象外
- ただしメモリ注入の上限は2000トークン概算
- メモリが増えすぎた場合: description のみ注入し、必要時に `memory_read` で全文取得

### 3.3 エージェントループ

#### 3.3.1 システムプロンプト
- `src/agent/prompt.ts`
- ツール説明の動的埋め込み（ToolRegistryから取得 → BuiltinもMCPも統一）
- 作業ディレクトリ・OS情報の注入
- **メモリの自動注入**（loader.tsから取得した関連メモリ）
- ツール呼び出しの正例1つ（few-shot）
- エラー時の自己修正指示

#### 3.3.2 エージェントループ本体
- `src/agent/loop.ts`
- ReActループ: LLM → tool_calls検出 → パーミッション → 実行 → 結果追加 → 再送信
- AgentState イベント発行（EventEmitter）
- 全ステップをloggerに記録

#### 3.3.3 エラーリカバリー

```
1. JSON構文エラー → 修復試行（末尾カンマ除去、クォート修正等）
2. 修復失敗 → LLMに具体的フィードバック:
   "Your tool call had invalid JSON. Error: {parse_error}. Raw: {truncated}."
3. 存在しないツール名 →
   "Tool '{name}' not found. Available: {list}. Did you mean '{closest}'?"
4. 3回連続失敗 → ユーザーに状況報告、ログにフル出力記録
```

#### 3.3.4 コンテキスト窓管理 [監査v2-1対応: トークン概算修正]

- `src/agent/context-manager.ts`

**トークン概算の修正**:

旧: `文字数 × 0.4`
改訂: **`UTF-8バイト長 / 4`**

```typescript
function estimateTokens(text: string): number {
  // UTF-8バイト長ベースの概算
  // - ASCII（英数字・記号）: 1バイト/文字 → ~0.25 tokens/byte
  // - 日本語（3バイト/文字）: → ~0.75 tokens/char（≒1 token/char に近い）
  // - コード（ASCII中心）: → ~0.25 tokens/byte
  // UTF-8バイト長/4 は混在コンテンツで最もバランスが良い
  const byteLength = new TextEncoder().encode(text).length;
  return Math.ceil(byteLength / 4);
}
```

検証: 「こんにちは」(15bytes) → 3.75 → 4 tokens概算（実測: 約3-5 tokens ✓）
     "hello world" (11bytes) → 2.75 → 3 tokens概算（実測: 約2-3 tokens ✓）

**プルーニング設計**:
- 上限: `config.agent.maxContextTokens`（デフォルト: 12,000）
  - 旧: 16,000 → 保守的に下げた（概算誤差のバッファ）
- systemプロンプト + メモリ注入 → 保護（プルーニング対象外）
- 直近3ターン → 保護
- 古いツール結果 → 1行要約に圧縮
- 古いassistant推論 → 1行要約に圧縮
- **プルーニングはメッセージ配列のコピーに対して実行** [監査v2-1対応]
  - 元のメッセージ履歴は保持（ログ・デバッグ用）
  - LLMリクエスト送信時のみプルーニング済み配列を使用

### 3.4 パーミッション連携
- permissionLevel チェック
- "confirm" → UserInteraction.requestPermission() コールバック
- "auto" → 即実行
- "deny" → 拒否通知

### 3.5 テスト
- `tests/tools/edit-file.test.ts` — ファジーマッチ・診断情報・不可視文字対応
- `tests/tools/*.test.ts` — 各ツールの正常系・異常系
- `tests/tools/grep.test.ts` — ripgrepパスとフォールバックパスの両方を明示テスト
- `tests/memory/store.test.ts` — メモリCRUD
- `tests/memory/loader.test.ts` — 自動読み込み・コンテキスト注入
- `tests/agent/loop.test.ts` — モックサーバー（streaming/malformed）使用
- `tests/agent/context-manager.test.ts` — プルーニング動作・トークン概算

### 検証
- リアリスティックモックサーバーでツールチェーン実行成功
- edit_file失敗時に診断情報が返る
- メモリの保存・読み込み・セッション開始時自動注入が動作
- コンテキストプルーニングが動作（日本語テキストでも概算が妥当）

---

## Phase 4: TUI - Ink コンポーネント

### 4.1 コンポーネント

| ファイル | 責務 |
|---------|------|
| `src/ui/theme.ts` | chalk ベースのカラーテーマ |
| `src/ui/Spinner.tsx` | 推論中インジケーター |
| `src/ui/Markdown.tsx` | marked + chalk でターミナルMarkdown |
| `src/ui/ToolCall.tsx` | ツール名・引数・結果 + 中間状態表示 |
| `src/ui/Permission.tsx` | 承認/拒否/常に許可 + diff プレビュー |
| `src/ui/Chat.tsx` | メッセージ一覧 |
| `src/ui/Input.tsx` | テキスト入力 + スラッシュコマンド |
| `src/ui/App.tsx` | ルート（AgentState管理、メモリ表示） |

### 4.2 非同期設計
- Inkの非同期レンダリングモデルで自然にノンブロッキング
- grepの長時間実行 → AbortController でキャンセル可能
- Worker Threadは実測でUIフリーズが確認された場合に検討

### 4.3 中間状態表示
```
[実行中] ⟳ grep: pattern="async" path="src/**/*.ts"
[完了]   ✓ grep: 3 files matched (12ms)
```

### 4.4 テスト
- ink-testing-library で App, Permission のテスト

### 検証
- TUI上でエージェントとの対話が成立
- ツール実行中に中間状態が表示される
- メモリの保存・読み込みがTUIから動作

---

## Phase 5: 統合・CLI・ビルド・評価

### 5.1 エントリーポイント
- `src/index.tsx`
- Commander.js CLI引数パース
- 設定読み込み + CLI引数マージ
- mlx_lm.server ヘルスチェック
- **メモリ自動読み込み**
- ToolRegistry初期化（initializeAll）
- Ink render(<App />)

### 5.2 スラッシュコマンド
- `/quit`, `/exit`, `/clear`, `/help`
- `/memory` → メモリ一覧表示

### 5.3 ビルド
- `bun build src/index.tsx --compile --outfile dist/polaris`

### 5.4 Headless Eval Mode [監査v2-6対応: 統計的妥当性強化]

- `scripts/run-evals.ts`

**実行方式の改訂**:

旧: 各タスク1回実行、5/5でパス
改訂: **各タスク3回実行、2/3以上成功で「パス」**（多数決方式）

```bash
bun run scripts/run-evals.ts --model qwen2.5-coder-32b --runs 3

# 出力例:
# create-file:       3/3 passed ✓
# edit-existing:     2/3 passed ✓
# search-and-answer: 3/3 passed ✓
# multi-step:        2/3 passed ✓
# error-recovery:    2/3 passed ✓
#
# Overall: 5/5 tasks passed (model: qwen2.5-coder-32b, runs: 3, duration: 11m15s)
```

**根拠**: ローカルLLMの出力は非決定的。temperature=0.1でもサンプリングノイズがある。
1回の実行で合否判定すると、成功率80%のタスクが20%の確率でフレーキーに失敗する。
3回中2回以上成功なら、真の成功率50%未満を高い確率で棄却できる。

**validate-toolcall.ts との統合** [監査v2-7対応]:
- `--live` フラグで実モデルテストとして実行可能
- eval実行前に自動でツール呼び出し検証を実行（プリフライトチェック）

**評価タスク** (5つ):
1. create-file: ファイル作成、TypeScript構文正確性
2. edit-existing: 既存ファイルの関数名変更
3. search-and-answer: 正しいファイルパスと行番号を含む回答
4. multi-step: ファイル作成 + bash実行の連鎖
5. error-recovery: 存在しないファイル指定からの回復

### 5.5 統合テスト
- リアリスティックモックサーバー + 自動入力でE2E

### 検証
- `dist/polaris` バイナリが単独起動
- 5つの評価タスクが全てパス（3回中2回以上）
- メモリが永続化され、再起動後に読み込まれる

---

## MCP拡張ロードマップ（post-MVP）

**現在のMVP**: 内蔵ツール10個（コア7 + メモリ3）

**post-MVPで追加する MCPToolProvider**:

```typescript
// src/mcp/provider.ts (post-MVP)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class MCPToolProvider implements ToolProvider {
  name: string;                    // "mcp:{serverName}"
  private client: Client;
  private transport: StdioClientTransport;

  constructor(serverConfig: MCPServerConfig) { ... }

  async initialize(): Promise<void> {
    // 1. StdioClientTransportでMCPサーバープロセスを起動
    // 2. client.connect() でハンドシェイク
    // 3. client.listTools() でツール定義を取得
  }

  tools(): ToolDefinition[] {
    // MCP ToolDefinition → Polaris ToolDefinition 変換
    // inputSchema (JSON Schema) → parameters (JSON Schema) は直接互換
    // permissionLevel: デフォルト "confirm"（外部ツールは保守的に）
  }

  async shutdown(): Promise<void> {
    await this.client.close();
  }
}
```

**設定ファイル拡張** (`~/.polaris/config.json`):
```json
{
  "mcp": {
    "servers": {
      "serena": {
        "command": "uvx",
        "args": ["serena-mcp"],
        "permission": "confirm"
      }
    }
  }
}
```

**Serenaとの統合で得られる価値**:
- `find_symbol`, `get_symbols_overview` → コード構造の意味的理解
- `replace_symbol_body`, `insert_after_symbol` → 構造を壊さない安全な編集
- `find_referencing_symbols` → リファクタリング時の影響範囲分析

**MCPを後回しにする理由**:
1. MVPの内蔵ツール（read_file, edit_file, grep）で基本的なコーディングは可能
2. MCPクライアントはプロセス管理（起動/終了/再起動/クラッシュ回復）が複雑
3. ToolProviderインターフェースを今設計しておけば、後から追加は容易
4. Constitution VI「Simplicity Over Completeness」に従う

**実装見積り**: MCPToolProvider + 設定読み込み + プロセス管理で約2-3日

---

## MVP達成パス

```
Phase 0   (Git整理)
  ↓
Phase 0.5 (プロンプト検証: 20回中17回以上成功)
  ↓
Phase 1   (Setup)
  ↓
Phase 2   (基盤 + ログ + リアリスティックモック + ToolProvider設計)
  ↓
Phase 3   (ツール + メモリ + ループ + コンテキスト管理)
  ↓                 ここでヘッドレス動作確認
Phase 4   (TUI)
  ↓
Phase 5   (統合 + 評価: 3回実行多数決方式)
```

post-MVP:
- MCP統合（MCPToolProvider実装）
- 複数ターン対話の強化
- モデル切り替え機能
- Worker Thread化（UIフリーズ実測時）

---

## 成果物一覧

```
package.json, tsconfig.json, bunfig.toml

# scripts
scripts/validate-toolcall.ts
scripts/run-evals.ts

# config
src/config/types.ts
src/config/settings.ts

# logging
src/logging/logger.ts

# llm
src/llm/types.ts
src/llm/client.ts
src/llm/stream.ts

# tools
src/tools/types.ts
src/tools/index.ts             # ToolRegistry + ToolProvider
src/tools/read-file.ts
src/tools/write-file.ts
src/tools/edit-file.ts
src/tools/glob.ts
src/tools/grep.ts
src/tools/bash.ts
src/tools/ask-user.ts
src/tools/post-edit-verify.ts

# memory (v3新規)
src/memory/types.ts
src/memory/store.ts
src/memory/loader.ts
src/memory/tools.ts

# agent
src/agent/types.ts
src/agent/loop.ts
src/agent/prompt.ts
src/agent/context-manager.ts

# ui
src/ui/theme.ts
src/ui/Spinner.tsx
src/ui/Markdown.tsx
src/ui/ToolCall.tsx
src/ui/Permission.tsx
src/ui/Chat.tsx
src/ui/Input.tsx
src/ui/App.tsx
src/index.tsx

# tests
tests/llm/mock-server.ts      # v3新規: リアリスティックモックサーバー
tests/llm/client.test.ts
tests/tools/registry.test.ts
tests/tools/read-file.test.ts
tests/tools/write-file.test.ts
tests/tools/edit-file.test.ts
tests/tools/glob.test.ts
tests/tools/grep.test.ts
tests/tools/bash.test.ts
tests/memory/store.test.ts    # v3新規
tests/memory/loader.test.ts   # v3新規
tests/agent/loop.test.ts
tests/agent/context-manager.test.ts
tests/ui/App.test.tsx
tests/ui/Permission.test.tsx
tests/evals/tasks/create-file.ts
tests/evals/tasks/edit-existing.ts
tests/evals/tasks/search-and-answer.ts
tests/evals/tasks/multi-step.ts
tests/evals/tasks/error-recovery.ts
```

## 監査対応トレーサビリティ

| # | 監査指摘 | 対応 | 反映先 |
|---|---------|------|--------|
| v1-1 | ReActループ脆弱性 | Phase 0.5, エラー診断具体化, few-shot | 0.5, 3.3 |
| v1-2 | edit_file実装難易度 | ファジーマッチ+診断, 自動構文チェック | 3.1.2, 3.1.3 |
| v1-3 | コンテキスト窓管理 | read_file 500行制限, プルーニング | 3.1.1, 3.3.4 |
| v1-4 | TUI非同期競合 | Ink非同期モデル, 中間状態表示 | 4.2, 4.3 |
| v1-5 | 評価プロトコル欠如 | Headless Eval Mode | 5.4 |
| **v2-1** | **トークン概算の日本語対応** | **UTF-8バイト長/4に変更, 上限12,000** | **3.3.4** |
| **v2-2** | **処理経路の一貫性** | **ask_userアダプター, grep出力統一** | **3.1.4, 3.1.5** |
| **v2-4** | **データ取り込みの網羅性** | **ストリーム不完全チャンク検出, エンコーディング対策** | **2.3, 3.1.1** |
| **v2-6** | **評価の統計的妥当性** | **3回実行多数決, Phase 0.5を20回に** | **0.5.3, 5.4** |
| **v2-7** | **テスト環境と本番の乖離** | **リアリスティックモックサーバー導入** | **2.6** |
| **新規** | **メモリ機能** | **memory/ モジュール, 3ツール, 自動読み込み** | **3.2** |
| **新規** | **MCP拡張性** | **ToolProviderインターフェース, ロードマップ** | **2.4, post-MVP** |

## Complexity Tracking

| 追加した複雑さ | 正当化理由 |
|---------------|-----------|
| ToolProvider抽象 | MCPを後から追加するための最小設計。MVP時点ではBuiltinProviderのみで追加コストは型定義のみ |
| memory/ モジュール | セッション間の知識永続化はCLIエージェントの実用性に直結。ファイルベースの単純実装で複雑さは限定的 |
| リアリスティックモック | テストの信頼性がMVP品質を左右。BunのHTTPサーバーで200行程度の実装 |
| トークン概算の変更 | TextEncoder.encode() 1行の変更。日本語環境での正確性向上 |

> Constitution VI に照らし、各追加は「なければ実用にならない」最小限に留めた。
