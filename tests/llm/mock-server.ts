/**
 * Realistic mock OpenAI-compatible server for testing.
 * Simulates streaming, malformed responses, timeouts, and incomplete streams.
 */

export type MockMode = "normal" | "streaming" | "malformed" | "timeout" | "incomplete";

export interface MockResponse {
  content?: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export interface MockServerConfig {
  mode: MockMode;
  responses: MockResponse[];
  chunkDelayMs?: number;
  timeoutMs?: number;
}

export class MockLLMServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private config: MockServerConfig;
  private responseIndex = 0;

  constructor(config: MockServerConfig) {
    this.config = config;
  }

  get port(): number {
    return this.server?.port ?? 0;
  }

  get baseURL(): string {
    return `http://localhost:${this.port}/v1`;
  }

  start(): void {
    this.server = Bun.serve({
      port: 0, // Auto-assign
      fetch: async (req) => {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          return new Response("OK", { status: 200 });
        }

        if (url.pathname === "/v1/chat/completions") {
          return this.handleChatCompletion(req);
        }

        return new Response("Not Found", { status: 404 });
      },
    });
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }

  private async handleChatCompletion(_req: Request): Promise<Response> {
    const resp = this.config.responses[this.responseIndex % this.config.responses.length];
    this.responseIndex++;

    if (!resp) {
      return new Response(JSON.stringify({ error: "No mock response" }), { status: 500 });
    }

    switch (this.config.mode) {
      case "normal":
        return this.normalResponse(resp);
      case "streaming":
        return this.streamingResponse(resp);
      case "malformed":
        return this.malformedResponse(resp);
      case "timeout":
        return this.timeoutResponse();
      case "incomplete":
        return this.incompleteResponse(resp);
    }
  }

  private normalResponse(resp: MockResponse): Response {
    // Even "normal" mode uses SSE since client always sends stream: true
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // Send content in one chunk
        if (resp.content) {
          send({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: { role: "assistant", content: resp.content },
              finish_reason: null,
            }],
          });
        }

        // Send tool calls in one chunk each
        if (resp.tool_calls) {
          for (let i = 0; i < resp.tool_calls.length; i++) {
            const tc = resp.tool_calls[i]!;
            send({
              id: "chatcmpl-mock",
              object: "chat.completion.chunk",
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: i,
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.arguments },
                  }],
                },
                finish_reason: null,
              }],
            });
          }
        }

        // Final chunk
        send({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: resp.tool_calls ? "tool_calls" : "stop",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }

  private streamingResponse(resp: MockResponse): Response {
    const delayMs = this.config.chunkDelayMs ?? 10;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // Stream text content character by character
        if (resp.content) {
          for (let i = 0; i < resp.content.length; i++) {
            send({
              id: "chatcmpl-mock",
              object: "chat.completion.chunk",
              choices: [{
                index: 0,
                delta: { content: resp.content[i] },
                finish_reason: null,
              }],
            });
            if (delayMs > 0) await Bun.sleep(delayMs);
          }
        }

        // Stream tool calls (split arguments across multiple chunks)
        if (resp.tool_calls) {
          for (let i = 0; i < resp.tool_calls.length; i++) {
            const tc = resp.tool_calls[i]!;

            // First chunk: id + name
            send({
              id: "chatcmpl-mock",
              object: "chat.completion.chunk",
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: i,
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: "" },
                  }],
                },
                finish_reason: null,
              }],
            });
            if (delayMs > 0) await Bun.sleep(delayMs);

            // Split arguments into chunks of ~20 chars
            const args = tc.arguments;
            for (let j = 0; j < args.length; j += 20) {
              const chunk = args.slice(j, j + 20);
              send({
                id: "chatcmpl-mock",
                object: "chat.completion.chunk",
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: i,
                      function: { arguments: chunk },
                    }],
                  },
                  finish_reason: null,
                }],
              });
              if (delayMs > 0) await Bun.sleep(delayMs);
            }
          }
        }

        // Final chunk with finish_reason
        send({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: resp.tool_calls ? "tool_calls" : "stop",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }

  private malformedResponse(resp: MockResponse): Response {
    // Return a tool call with malformed JSON arguments
    const malformedArgs = resp.tool_calls?.[0]
      ? resp.tool_calls[0].arguments.slice(0, -1) + ",}"  // trailing comma before }
      : '{"path": "test.ts",}';

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        send({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_malformed",
                type: "function",
                function: {
                  name: resp.tool_calls?.[0]?.name ?? "read_file",
                  arguments: malformedArgs,
                },
              }],
            },
            finish_reason: null,
          }],
        });

        send({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  private async timeoutResponse(): Promise<Response> {
    const timeoutMs = this.config.timeoutMs ?? 5000;
    await Bun.sleep(timeoutMs);
    return new Response("", { status: 504 });
  }

  private incompleteResponse(resp: MockResponse): Response {
    // Start streaming but cut off mid-way (simulating max_tokens or crash)
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        if (resp.tool_calls?.[0]) {
          const tc = resp.tool_calls[0];
          // Send tool call start
          send({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: "" },
                }],
              },
              finish_reason: null,
            }],
          });

          // Send only half the arguments, then close
          const halfArgs = tc.arguments.slice(0, Math.floor(tc.arguments.length / 2));
          send({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: halfArgs },
                }],
              },
              finish_reason: null,
            }],
          });
        } else if (resp.content) {
          // Send half the content
          const half = resp.content.slice(0, Math.floor(resp.content.length / 2));
          send({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: { content: half },
              finish_reason: null,
            }],
          });
        }

        // Close without finish_reason or [DONE]
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
}
