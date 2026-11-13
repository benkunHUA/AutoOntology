import { describe, expect, it } from "vitest";
import type {
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
  ToolHandler,
  ToolResult,
} from "@ao/protocol";
import { Session } from "../src/session.ts";

function blockedClient(): ModelClient {
  return {
    id: "blocked",
    async *stream(_request: ModelRequest, options: StreamOptions) {
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: {
          type: "function_call",
          callId: "call_1",
          name: "wait_tool",
          arguments: "{}",
        },
      };
      // 停留在流中，直到外部 abort；拒绝原因走 signal.reason。
      await new Promise<never>((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    },
  };
}

function blockedHandler(): ToolHandler {
  return {
    spec: { name: "wait_tool", description: "", parameters: {} },
    execute: (_args, ctx) =>
      new Promise<ToolResult>((_, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => reject(ctx.signal.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timeout");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("Session 中断收尾", () => {
  it("先回填缺失的工具结果，再落剩余输入与中断标记", async () => {
    const session = new Session({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: blockedClient(),
      handlers: [blockedHandler()],
      emit: () => {},
    });

    session.submit("hello");
    await waitUntil(() =>
      session.history
        .serialize()
        .some((item) => item.type === "function_call" && item.callId === "call_1"),
    );

    session.submit("interject");
    await session.abort("user");
    await session.whenIdle();

    const items = session.history.serialize();
    expect(items.map((item) => item.type)).toEqual([
      "message",
      "function_call",
      "function_call_output",
      "message",
      "turn_marker",
    ]);
    expect(items[2]).toMatchObject({
      type: "function_call_output",
      callId: "call_1",
      ok: false,
    });
    expect(items[4]).toMatchObject({ type: "turn_marker", kind: "aborted" });
  });
});
