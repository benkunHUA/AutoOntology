/**
 * 上下文压缩（对应设计 11 节）。
 *
 * 骨架阶段只实现「判定」：超阈值时记录警告；真正的摘要重写在 M2 落地，
 * 届时替换 CompactFn 的默认实现（对旧历史生成摘要、追加 compacted 标记、
 * 重置世界状态基线，遵守 I6：压缩先于新输入落账）。
 */
import type { ContextManager } from "./context-manager.ts";

export const DEFAULT_CONTEXT_LIMIT_TOKENS = 200_000;
export const COMPACT_THRESHOLD_RATIO = 0.8;

export interface CompactOutcome {
  compacted: boolean;
  reason?: "over_threshold" | "not_needed" | "disabled";
}

export type CompactFn = (history: ContextManager) => Promise<CompactOutcome>;

export const noopCompact: CompactFn = async () => ({
  compacted: false,
  reason: "disabled",
});

export function shouldCompact(
  history: ContextManager,
  contextLimitTokens = DEFAULT_CONTEXT_LIMIT_TOKENS,
): boolean {
  return history.estimateTokens() > contextLimitTokens * COMPACT_THRESHOLD_RATIO;
}
