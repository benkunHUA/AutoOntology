/**
 * 对话历史（对应 ContextManager / 历史即事实源 G2）。
 *
 * 不变量 I2：只追加。所有修改都经过 append，便于：
 * - 追加式落盘
 * - 前缀缓存友好（不修改已有条目）
 * - 世界状态差异注入（M2，以追加带标记的消息实现）
 */
import type { FunctionCallOutputItem, HistoryItem } from "@ao/protocol";
import { functionCallOutput } from "@ao/protocol";

export class ContextManager {
  private items: HistoryItem[] = [];
  private readonly onAppend?: (item: HistoryItem) => void;

  constructor(options: { onAppend?: (item: HistoryItem) => void } = {}) {
    this.onAppend = options.onAppend;
  }

  append(item: HistoryItem): void {
    this.items.push(item);
    this.onAppend?.(item);
  }

  /** 序列化给模型请求。返回浅拷贝，调用方不能靠它改历史。 */
  serialize(): HistoryItem[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  /** 粗略 token 估算（chars/4），压缩层接入前用于观测。 */
  estimateTokens(): number {
    let chars = 0;
    for (const item of this.items) {
      switch (item.type) {
        case "message":
          chars += item.text.length;
          break;
        case "function_call":
          chars += item.name.length + item.arguments.length;
          break;
        case "function_call_output":
          chars += item.output.length;
          break;
        case "turn_marker":
          chars += item.detail.length;
          break;
      }
    }
    return Math.ceil(chars / 4);
  }

  /**
   * 不变量 I3：每个 function_call 必须有对应 output。
   * 取消/出错路径调用：为缺失结果的调用补「被中断」条目。
   */
  backfillMissingToolOutputs(reason: string): FunctionCallOutputItem[] {
    const answered = new Set<string>();
    for (const item of this.items) {
      if (item.type === "function_call_output") answered.add(item.callId);
    }
    const appended: FunctionCallOutputItem[] = [];
    for (const item of this.items) {
      if (item.type === "function_call" && !answered.has(item.callId)) {
        const output = functionCallOutput(item.callId, `aborted: ${reason}`, false);
        this.append(output);
        appended.push(output);
      }
    }
    return appended;
  }
}
