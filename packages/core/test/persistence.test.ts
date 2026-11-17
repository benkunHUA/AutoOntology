import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest, ResponseEvent, StreamOptions } from "@ao/protocol";
import { threadPersistencePath } from "../src/persistence.ts";
import { Session } from "../src/session.ts";

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

describe("JsonlPersistence path", () => {
  it("按 sessionId/threadId 生成路径", () => {
    expect(threadPersistencePath("/root", "session_1", "thread_1")).toBe(
      join("/root", "session_1", "thread_1.jsonl"),
    );
  });

  it("Session 使用 persistenceDir 时写入 thread 专属文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-persist-"));
    const root = join(dir, ".ao", "sessions");
    const session = new Session({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: oneShotClient(),
      handlers: [],
      emit: () => {},
      identity: {
        threadId: "thread_1",
        sessionId: "session_1",
        rootThreadId: "session_1",
      },
      persistenceDir: root,
    });

    await session.submit("hello");
    await session.whenIdle();

    const file = await readFile(
      join(root, "session_1", "thread_1.jsonl"),
      "utf8",
    );
    expect(file).toContain('"role":"user"');
    expect(file).toContain("hello");
  });
});
