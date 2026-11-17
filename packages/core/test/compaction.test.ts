import { describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest, ResponseEvent, StreamOptions } from "@ao/protocol";
import { ContextManager } from "../src/context-manager.ts";
import { shouldCompact, SummaryCompactor } from "../src/compaction.ts";

function summaryClient(summary: string): ModelClient {
  return {
    id: "summary",
    async *stream(_request: ModelRequest, _options: StreamOptions): AsyncGenerator<ResponseEvent> {
      yield { type: "item_started", index: 0 };
      for (const chunk of summary.match(/.{1,8}/g) ?? [summary]) {
        yield { type: "text_delta", index: 0, delta: chunk };
      }
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: summary },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

describe("SummaryCompactor", () => {
  it("超阈值时生成摘要并替换历史", async () => {
    const history = new ContextManager();
    for (let i = 0; i < 10; i++) {
      history.append({ type: "message", role: "user", text: `x`.repeat(100) });
    }
    expect(shouldCompact(history, 1)).toBe(true);

    const compactor = new SummaryCompactor(summaryClient("final summary"), "test");
    const outcome = await compactor.compact(history, { signal: new AbortController().signal });

    expect(outcome.compacted).toBe(true);
    expect(outcome.summary).toBe("final summary");
    expect(history.serialize()).toEqual([
      {
        type: "message",
        role: "developer",
        text: "[compaction summary]\nfinal summary",
      },
    ]);
  });
});
