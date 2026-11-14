/**
 * 上下文压缩。
 *
 * 当前只实现「判定」：超阈值时记录警告；真正的摘要重写留待后续实现。
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
