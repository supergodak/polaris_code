import type OpenAI from "openai";

// Re-export OpenAI SDK types for convenience
export type ChatCompletionMessage = OpenAI.ChatCompletionMessage;
export type ChatCompletionMessageParam = OpenAI.ChatCompletionMessageParam;
export type ChatCompletionTool = OpenAI.ChatCompletionTool;
export type ChatCompletionMessageToolCall = OpenAI.ChatCompletionMessageToolCall;

// Simplified message type for internal use
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface StreamChunk {
  type: "text" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done";
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
