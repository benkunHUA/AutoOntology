/**
 * 对话历史的条目模型。
 *
 * 历史只追加，不原地修改。所有条目都是可 JSON 序列化的纯数据，
 * 便于追加式落盘与断点恢复。
 */

export type Role = "system" | "developer" | "user" | "assistant";

export interface MessageItem {
  type: "message";
  role: Role;
  /** 文本片段。多模态扩展时在这里增加 image 等片段类型。 */
  text: string;
}

export interface FunctionCallItem {
  type: "function_call";
  callId: string;
  name: string;
  /** 模型给出的原始 JSON 参数字符串。解析失败按工具失败处理，不改写历史。 */
  arguments: string;
}

export interface FunctionCallOutputItem {
  type: "function_call_output";
  callId: string;
  output: string;
  ok: boolean;
}

/** 中断标记：任务被取消时追加，保证中断必须留痕。 */
export interface TurnMarkerItem {
  type: "turn_marker";
  kind: "aborted" | "error" | "compacted";
  detail: string;
  at: string;
}

export type HistoryItem =
  | MessageItem
  | FunctionCallItem
  | FunctionCallOutputItem
  | TurnMarkerItem;

export const message = (role: Role, text: string): MessageItem => ({
  type: "message",
  role,
  text,
});

export const functionCallOutput = (
  callId: string,
  output: string,
  ok: boolean,
): FunctionCallOutputItem => ({
  type: "function_call_output",
  callId,
  output,
  ok,
});
