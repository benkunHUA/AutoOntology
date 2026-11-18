/**
 * OpenAI Responses API 客户端（SSE 流式）。
 *
 * 职责边界：只做「协议 → 归一化 ResponseEvent」的翻译，不做重试
 * （重试在 retry.ts）也不碰历史（历史归 core）。断线时抛错，由重试层决定。
 */
import type {
  HistoryItem,
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";
import { parseSse } from "./sse.ts";

export interface ResponsesClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** 单请求空闲超时（毫秒）。等待流内任何字节超过该值即视为传输错误。 */
  idleTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ResponsesClient implements ModelClient {
  readonly id = "responses";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly idleTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResponsesClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(
    request: ModelRequest,
    options: StreamOptions,
  ): AsyncIterable<ResponseEvent> {
    const idle = withIdleTimeout(options.signal, this.idleTimeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: idle.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          instructions: request.instructions,
          input: request.input.map(toResponsesItem),
          tools: request.tools.map((t) => ({
            type: "function",
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            strict: false,
          })),
          stream: true,
          // 让服务端显式回传 item 与完成状态
          parallel_tool_calls: true,
          ...(request.maxOutputTokens !== undefined
            ? { max_output_tokens: request.maxOutputTokens }
            : {}),
        }),
      });
    } finally {
      idle.ping();
    }

    if (!response.ok || !response.body) {
      const text = response.ok ? "empty body" : await safeText(response);
      throw new TransportError(`HTTP ${response.status}: ${text}`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const textDeltas = new Map<number, string>();

    try {
      for await (const data of parseSse(response.body)) {
        idle.ping();
        if (data === "[DONE]") break;

        let raw: any;
        try {
          raw = JSON.parse(data);
        } catch {
          // 半截 JSON：协议层错误，不重试（重试会重复展示增量）
          throw new TransportError(`malformed SSE payload: ${data.slice(0, 80)}`, {
            retryable: false,
          });
        }

        switch (raw.type as string) {
          case "response.output_item.added":
            yield { type: "item_started", index: raw.output_index ?? 0 };
            break;

          case "response.output_text.delta": {
            const index = raw.output_index ?? 0;
            textDeltas.set(index, (textDeltas.get(index) ?? "") + raw.delta);
            yield { type: "text_delta", index, delta: raw.delta };
            break;
          }

          case "response.reasoning_summary_text.delta":
          case "response.reasoning_text.delta":
            yield {
              type: "reasoning_delta",
              index: raw.output_index ?? 0,
              delta: raw.delta,
            };
            break;

          case "response.output_item.done": {
            const item = fromResponsesItem(raw.item);
            if (item) yield { type: "item_done", index: raw.output_index ?? 0, item };
            break;
          }

          case "response.completed":
          case "response.incomplete": {
            const usage = raw.response?.usage;
            yield {
              type: "response_completed",
              needsContinue: raw.type === "response.incomplete",
              usage: usage
                ? {
                    inputTokens: usage.input_tokens ?? 0,
                    outputTokens: usage.output_tokens ?? 0,
                  }
                : undefined,
            };
            return;
          }

          case "response.failed":
          case "error": {
            const message =
              raw.response?.error?.message ?? raw.message ?? "unknown error";
            yield { type: "error", message, retryable: false };
            return;
          }

          // response.created / in_progress 等非增量事件忽略
          default:
            break;
        }
      }
      // 流被服务端提前关闭：视为传输错误，交给重试层
      throw new TransportError("stream closed before response.completed", {
        retryable: true,
      });
    } finally {
      idle.dispose();
    }
  }
}

export class TransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts: { retryable: boolean }) {
    super(message);
    this.name = "TransportError";
    this.retryable = opts.retryable;
  }
}

/** 统一的内部条目 → Responses API item。 */
function toResponsesItem(item: HistoryItem): Record<string, unknown> {
  switch (item.type) {
    case "message":
      return {
        type: "message",
        role: item.role,
        content: [{ type: "input_text", text: item.text }],
      };
    case "function_call":
      return {
        type: "function_call",
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
      };
    case "function_call_output":
      return {
        type: "function_call_output",
        call_id: item.callId,
        output: item.output,
      };
    case "turn_marker":
      return {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: `[${item.kind}] ${item.detail}` }],
      };
  }
}

/** Responses API item → 内部条目。不认识的条目返回 null。 */
function fromResponsesItem(raw: any): HistoryItem | null {
  if (!raw) return null;
  if (raw.type === "message") {
    const text: string = Array.isArray(raw.content)
      ? raw.content
          .filter((p: any) => typeof p?.text === "string")
          .map((p: any) => p.text)
          .join("")
      : "";
    return { type: "message", role: raw.role ?? "assistant", text };
  }
  if (raw.type === "function_call") {
    return {
      type: "function_call",
      callId: raw.call_id,
      name: raw.name,
      arguments: raw.arguments ?? "{}",
    };
  }
  return null;
}

/**
 * 空闲超时：每次收到数据 ping 一下；超时触发一个同源 AbortSignal。
 * 外部取消也合并进来。
 */
function withIdleTimeout(parent: AbortSignal, ms: number) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onParentAbort, { once: true });

  const ping = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error("idle timeout")),
      ms,
    );
  };
  ping();

  return {
    signal: controller.signal,
    ping,
    dispose() {
      if (timer) clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}
