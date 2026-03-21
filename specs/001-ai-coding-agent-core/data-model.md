# Data Model: AI-Driven Coding Agent CLI (v3)

**Date**: 2026-03-20 (Updated: メモリ機能, ToolProvider, diagnostics追加)

## Entities

### Message
会話中の1つのメッセージ。OpenAI SDK の ChatCompletionMessageParam に準拠。

```typescript
type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name: string };
```

### ToolCall
LLMが生成したツール呼び出し要求。OpenAI SDK の ChatCompletionMessageToolCall に準拠。

```typescript
interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}
```

### ToolDefinition
エージェントが使用可能なツールの定義。

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema; // JSON Schema object
  permissionLevel: "auto" | "confirm" | "deny";
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
```

### ToolResult
ツール実行の結果。edit_file失敗時の診断情報を含む。

```typescript
interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  diagnostics?: EditDiagnostics;  // edit_file専用
}

interface EditDiagnostics {
  closest_match?: string;    // 最も近い部分テキスト
  similarity?: number;       // 0.0-1.0 の類似度
  line_range?: [number, number];  // 候補の行範囲
  hint?: string;             // LLMへの自己修正ヒント
}
```

### ToolProvider
ツール群を提供する抽象インターフェース。MVP: BuiltinToolProvider のみ。post-MVP: MCPToolProvider 追加。

```typescript
interface ToolProvider {
  name: string;                          // "builtin" | "mcp:{serverName}"
  tools(): ToolDefinition[];
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
```

### AgentState
エージェントの現在の状態。UIの表示制御に使用。

```typescript
type AgentState =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "tool_calling"; toolName: string; args: Record<string, unknown> }
  | { type: "awaiting_permission"; toolName: string; args: Record<string, unknown>; resolve: (approved: boolean) => void }
  | { type: "executing"; toolName: string }
  | { type: "responding"; content: string };
```

### UserInteraction
ユーザーとの対話を抽象化するインターフェース。TUIモードとヘッドレスモードで統一。

```typescript
interface UserInteraction {
  ask(question: string): Promise<string>;
  requestPermission(tool: string, args: unknown): Promise<boolean>;
}
```

### MemoryEntry
セッション間で永続するメモリの1エントリー。

```typescript
interface MemoryEntry {
  name: string;                // メモリ名（ファイル名に使用）
  description: string;         // 1行の説明（検索・自動読み込みに使用）
  type: "user" | "project" | "feedback" | "reference";
  content: string;             // メモリ本文
  filePath: string;            // 実ファイルパス
  updatedAt: string;           // ISO 8601
}
```

### MemoryStore
メモリの読み書きインターフェース。

```typescript
interface MemoryStore {
  list(scope: "global" | "project"): Promise<MemoryEntry[]>;
  read(name: string): Promise<MemoryEntry | null>;
  write(entry: Omit<MemoryEntry, "filePath" | "updatedAt">): Promise<void>;
  delete(name: string): Promise<boolean>;
  search(query: string): Promise<MemoryEntry[]>;
}
```

### PolarisConfig
エージェントの動作設定。

```typescript
interface PolarisConfig {
  llm: {
    apiBase: string;           // default: "http://localhost:8080/v1"
    model: string;             // default: "default"
    temperature: number;       // default: 0.1
    maxTokens: number;         // default: 4096
  };
  agent: {
    maxIterations: number;     // default: 25
    maxContextTokens: number;  // default: 12000
    systemPrompt?: string;     // optional override
  };
  permissions: Record<string, "auto" | "confirm" | "deny">;
  memory: {
    enabled: boolean;          // default: true
    globalDir: string;         // default: "~/.polaris/memory"
    autoLoad: boolean;         // default: true
    maxInjectionTokens: number; // default: 2000
  };
  logging: {
    level: "debug" | "info" | "off";  // default: "info"
    dir: string;               // default: "~/.polaris/logs"
  };
  // post-MVP: MCP設定
  // mcp?: {
  //   servers: Record<string, {
  //     command: string;
  //     args?: string[];
  //     permission?: "auto" | "confirm";
  //   }>;
  // };
}
```

## Relationships

```
PolarisConfig --configures--> AgentLoop
AgentLoop --manages--> Message[]
AgentLoop --uses--> ToolRegistry
ToolRegistry --contains--> ToolProvider[]
ToolProvider --provides--> ToolDefinition[]
Message --contains--> ToolCall[]
ToolCall --dispatches-to--> ToolDefinition
ToolDefinition --produces--> ToolResult
AgentLoop --emits--> AgentState (for UI)
AgentLoop --uses--> MemoryStore (via loader)
AgentLoop --uses--> UserInteraction (via adapter)
AgentLoop --uses--> ContextManager (pruning)
```

## State Transitions

### Agent Loop States
```
IDLE --> THINKING --> TOOL_CALLING --> AWAITING_PERMISSION --> EXECUTING --> OBSERVING --> THINKING
                  |                                                                         |
                  +---(no tool_calls)---> RESPONDING --> IDLE
```

### Memory Lifecycle
```
Session Start --> loadRelevantMemories() --> Inject to SystemPrompt
                                                    |
During Session --> memory_write tool --> MemoryStore.write() --> .polaris/memory/*.md
               --> memory_read tool  --> MemoryStore.read()
               --> memory_list tool  --> MemoryStore.list()
                                                    |
Next Session Start --> loadRelevantMemories() --> memories available
```

## Storage Layout

```
~/.polaris/
  config.json              # グローバル設定
  memory/                  # グローバルメモリ
    user_preferences.md
    coding_style.md
  logs/                    # セッションログ（JSONL）
    session-2026-03-20T12-00-00.jsonl

{project}/
  .polaris/
    memory/                # プロジェクトメモリ
      MEMORY.md            # インデックス
      project_architecture.md
      current_tasks.md
```
