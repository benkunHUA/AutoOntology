import { describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest, ResponseEvent, StreamOptions } from "@ao/protocol";
import { Thread } from "../src/engine/thread.ts";

function summaryClient(summary: string): ModelClient {
  return {
    id: "summary",
    async *stream(_request: ModelRequest, _options: StreamOptions): AsyncGenerator<ResponseEvent> {
      yield { type: "item_started", index: 0 };
      yield { type: "text_delta", index: 0, delta: summary };
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

describe("Thread compaction", () => {
  it("exposes a manual compact operation that rewrites history", async () => {
    const thread = new Thread({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: summaryClient("final summary"),
      handlers: [],
      emit: () => {},
    });
    thread.history.append({ type: "message", role: "user", text: "remember this" });

    const outcome = await thread.compact();

    expect(outcome.compacted).toBe(true);
    const items = thread.history.serialize();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "message", role: "user" });
    if (items[0].type === "message") {
      expect(items[0].text).toContain("[Compacted]");
      expect(items[0].text).toContain("final summary");
    }
  });
});
