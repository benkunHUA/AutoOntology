/**
 * 对话历史。
 *
 * 历史只追加。所有修改都经过 append，便于：
 * - 追加式落盘
 * - 前缀缓存友好（不修改已有条目）
 * - 世界状态差异注入（以追加带标记的消息实现）
 */
import type { FunctionCallOutputItem, HistoryItem } from "@ao/protocol";
import { functionCallOutput } from "@ao/protocol";
import { estimateItemTokenCount } from "./tokens.ts";

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

  /** 序列化给模型请求。数组是副本，条目对象仍是共享引用，调用方不得修改条目内容。 */
  serialize(): HistoryItem[] {
    return [...this.items];
  }

  /** 压缩重写内存历史。持久化层仍保持追加语义，旧条目不回退。 */
  replaceAll(items: HistoryItem[]): void {
    this.items = [...items];
  }

  get size(): number {
    return this.items.length;
  }

  /** 粗略 token 估算，供压缩阈值与观测使用。 */
  estimateTokens(): number {
    let tokens = 0;
    for (const item of this.items) {
      tokens += estimateItemTokenCount(item);
    }
    return tokens;
  }

  /**
   * 每个 function_call 必须有对应 output。
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
