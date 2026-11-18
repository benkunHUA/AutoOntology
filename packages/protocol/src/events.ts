/**
 * 采样层事件：provider 适配层把各家协议归一化成这一个联合类型。
 * core 只消费这些事件，不知道底层是 SSE 还是别的传输。
 */
import type { HistoryItem } from "./items.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ResponseEvent =
  | { type: "item_started"; index: number }
  | { type: "text_delta"; index: number; delta: string }
  | { type: "reasoning_delta"; index: number; delta: string }
  | { type: "item_done"; index: number; item: HistoryItem }
  | {
      type: "response_completed";
      /** 服务端完成标记（例如 incomplete / 需要继续的语义）。 */
      needsContinue: boolean;
      usage?: Usage;
    }
  | {
      type: "error";
      message: string;
      /** 可重试的传输层错误；不可重试则直接终止任务。 */
      retryable: boolean;
    };

export interface ModelRequest {
  model: string;
  /** 系统指令：每次请求重建，不进历史。 */
  instructions: string;
  /** 历史序列化结果。 */
  input: HistoryItem[];
  /** 本步骤可见的工具表（只下发给模型，不进历史）。 */
  tools: ToolSchemaNode[];
  /** 可选的最大输出 token 数；仅压缩等受控请求需要。 */
  maxOutputTokens?: number;
}

/** 发给模型的工具 schema（协议无关的中间形态）。 */
export interface ToolSchemaNode {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamOptions {
  signal: AbortSignal;
}

/** 统一的模型客户端接口。provider 实现、mock 实现都实现它。 */
export interface ModelClient {
  readonly id: string;
  stream(request: ModelRequest, options: StreamOptions): AsyncIterable<ResponseEvent>;
}
