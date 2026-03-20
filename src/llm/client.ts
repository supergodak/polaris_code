import OpenAI from "openai";
import type { Message, ToolCall, StreamChunk } from "./types.ts";
import type { ChatCompletionTool } from "./types.ts";

export interface LLMClientConfig {
  apiBase: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMClientConfig) {
    this.client = new OpenAI({
      baseURL: config.apiBase,
      apiKey: "not-needed", // mlx_lm.server doesn't require auth
    });
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
  }

  async *chat(
    messages: Message[],
    tools?: ChatCompletionTool[],
  ): AsyncGenerator<StreamChunk> {
    const params: OpenAI.ChatCompletionCreateParams = {
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    const stream = await this.client.chat.completions.create(params);

    // Buffer for accumulating tool calls across chunks
    const toolCallBuffers = new Map<number, {
      id: string;
      name: string;
      arguments: string;
    }>();
    let hasContent = false;
    let toolCallsEmitted = false;

    for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        hasContent = true;
        yield { type: "text", content: delta.content };
      }

      // Tool calls (may arrive across multiple chunks)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let buf = toolCallBuffers.get(idx);

          if (!buf) {
            buf = { id: "", name: "", arguments: "" };
            toolCallBuffers.set(idx, buf);
          }

          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) {
            buf.name = tc.function.name;
            yield {
              type: "tool_call_start",
              toolCall: {
                id: buf.id,
                type: "function",
                function: { name: buf.name, arguments: "" },
              },
            };
          }
          if (tc.function?.arguments) {
            buf.arguments += tc.function.arguments;
            yield {
              type: "tool_call_delta",
              content: tc.function.arguments,
            };
          }
        }
      }

      // Check for finish reason
      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === "tool_calls" || finishReason === "stop") {
        // Emit completed tool calls
        for (const [, buf] of toolCallBuffers) {
          if (buf.id && buf.name) {
            yield {
              type: "tool_call_end",
              toolCall: {
                id: buf.id,
                type: "function",
                function: {
                  name: buf.name,
                  arguments: buf.arguments,
                },
              },
            };
          }
        }
        toolCallsEmitted = true;
      }

      // Usage info (usually in last chunk)
      if (chunk.usage) {
        yield {
          type: "done",
          usage: {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
          },
        };
      }
    }

    // Handle incomplete stream: tool calls buffered but no finish_reason received
    if (toolCallBuffers.size > 0 && !toolCallsEmitted) {
      for (const [, buf] of toolCallBuffers) {
        if (buf.id && buf.name) {
          // Emit regardless of JSON validity - loop.ts will attempt repair
          yield {
            type: "tool_call_end",
            toolCall: {
              id: buf.id,
              type: "function",
              function: {
                name: buf.name,
                arguments: buf.arguments || "{}",
              },
            },
          };
        }
      }
    }

    yield { type: "done" };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(
        this.client.baseURL.replace(/\/v1\/?$/, "/health"),
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
