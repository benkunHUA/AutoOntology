/**
 * 上下文压缩。
 *
 * 判定与执行分离：shouldCompact 只做阈值判断；Compactor 负责真正生成
 * 摘要并重写历史。压缩失败时由调用方按阶段决定是否保留答复。
 */
import type { ModelClient } from "@ao/protocol";
import { message } from "@ao/protocol";
import type { ContextManager } from "./context-manager.ts";

export const DEFAULT_CONTEXT_LIMIT_TOKENS = 200_000;
export const COMPACT_THRESHOLD_RATIO = 0.8;

export interface CompactOutcome {
  compacted: boolean;
  reason?: "over_threshold" | "not_needed" | "disabled";
  summary?: string;
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

export interface CompactContext {
  signal: AbortSignal;
}

export interface Compactor {
  compact(history: ContextManager, ctx: CompactContext): Promise<CompactOutcome>;
}

const SUMMARY_INSTRUCTIONS =
  "Summarize the conversation into a single developer message. " +
  "Preserve the user's goals, decisions made, current state, and open work.";

/** 使用现有模型客户端生成摘要，并用摘要替换内存历史。 */
export class SummaryCompactor implements Compactor {
  constructor(
    private readonly client: ModelClient,
    private readonly model: string,
    private readonly instructions = SUMMARY_INSTRUCTIONS,
  ) {}

  async compact(history: ContextManager, ctx: CompactContext): Promise<CompactOutcome> {
    let text = "";
    const events = this.client.stream(
      {
        model: this.model,
        instructions: this.instructions,
        input: history.serialize(),
        tools: [],
      },
      { signal: ctx.signal },
    );

    for await (const event of events) {
      if (event.type === "text_delta") {
        text += event.delta;
      } else if (event.type === "item_done") {
        if (event.item.type === "message" && event.item.role === "assistant") {
          text = event.item.text || text;
        }
      } else if (event.type === "error") {
        return { compacted: false, reason: "not_needed" };
      }
    }

    if (!text.trim()) return { compacted: false, reason: "not_needed" };
    history.replaceAll([
      message("developer", `[compaction summary]\n${text.trim()}`),
    ]);
    return { compacted: true, reason: "over_threshold", summary: text.trim() };
  }
}
