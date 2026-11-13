/**
 * 扩展点（对应设计 14 节）。全部可选，默认行为不依赖任何钩子。
 */
import type { FunctionCallItem, ToolResult } from "@ao/protocol";
import type { PendingInput } from "./input-queue.ts";
import type { TurnContext } from "./turn-context.ts";

export interface ToolEndInfo {
  call: FunctionCallItem;
  result: ToolResult;
  durationMs: number;
}

export interface TurnSummary {
  turnId: string;
  finalMessage: string | null;
  durationMs: number;
  toolCalls: number;
  estimateTokens: number;
}

export interface AgentHooks {
  /**
   * 输入审查：返回 null 表示拦截该输入；返回字符串则替换内容后落账。
   */
  reviewInput?(
    input: PendingInput,
    turn: TurnContext,
  ): Promise<string | null> | string | null;

  /** 工具生命周期观察者（审计/遥测）。 */
  onToolEnd?(info: ToolEndInfo): void;

  /**
   * 停止钩子：采样循环判定「可收工」时调用。
   * 返回 false 表示强制继续（例如后台压缩尚未完成）。
   */
  beforeFinish?(summary: TurnSummary): boolean;

  /** 回合终态（完成/中断/出错后统一回调）。 */
  onTurnEnd?(outcome: "completed" | "aborted" | "error"): void;
}
