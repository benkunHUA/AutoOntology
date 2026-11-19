import { describe, expect, it } from "vitest";
import type {
  HistoryItem,
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";
import type { AgentHooks } from "../src/engine/hooks.ts";
import { Session } from "../src/engine/session.ts";

function oneShotClient(): ModelClient {
  return {
    id: "one-shot",
    async *stream(_request: ModelRequest, _options: StreamOptions): AsyncGenerator<ResponseEvent> {
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: "done" },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function twoStepClient(): ModelClient {
  return {
    id: "two-step",
    async *stream(request: ModelRequest, _options: StreamOptions): AsyncGenerator<ResponseEvent> {
      const last = request.input.at(-1);
      if (last?.type !== "function_call_output") {
        yield { type: "item_started", index: 0 };
        yield {
          type: "item_done",
          index: 0,
          item: {
            type: "function_call",
            callId: "call_1",
            name: "noop",
            arguments: "{}",
          },
        };
        yield { type: "response_completed", needsContinue: true };
        return;
      }
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: "done" },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function session(options: {
  client: ModelClient;
  reviewInput?: AgentHooks["reviewInput"];
}): Session {
  return new Session({
    cwd: "/tmp",
    model: "test",
    instructions: "",
    client: options.client,
    handlers: [],
    emit: () => {},
    hooks: options.reviewInput
      ? { reviewInput: options.reviewInput }
      : undefined,
  });
}

describe("Submission modes", () => {
  it("按模式分流：steer 空闲拒绝，start-if-idle 与 continue-if-idle 空闲开新单", async () => {
    const s = session({ client: oneShotClient() });

    await expect(s.submit("a", "steer")).resolves.toBe("rejected");
    await expect(s.submit("a", "start-if-idle")).resolves.toBe("started");
    await s.whenIdle();
    await expect(s.submit("b", "continue-if-idle")).resolves.toBe("started");
    await s.whenIdle();
  });

  it("首次输入与插话输入都经过 reviewInput", async () => {
    const reviews: string[] = [];
    const s = session({
      client: twoStepClient(),
      reviewInput: (input) => {
        reviews.push(input.text);
        return `reviewed:${input.text}`;
      },
    });

    await s.submit("first");
    await s.submit("interject", "steer");
    await s.whenIdle();

    expect(reviews).toEqual(["first", "interject"]);
    const messages = s.history
      .serialize()
      .filter((item: HistoryItem) => item.type === "message" && item.role === "user")
      .map((item) => item.type === "message" ? item.text : "");
    expect(messages).toEqual(["reviewed:first", "reviewed:interject"]);
  });
});
