import { describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest, ResponseEvent, StreamOptions } from "@ao/protocol";
import { Thread } from "../src/thread.ts";
import { ThreadManager } from "../src/thread-manager.ts";

function idleClient(): ModelClient {
  return {
    id: "idle",
    async *stream(_request: ModelRequest, _options: StreamOptions): AsyncGenerator<ResponseEvent> {
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: "ok" },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

describe("Thread", () => {
  it("是 Session 的顶层门面，root thread 的 sessionId 与 threadId 默认一致", () => {
    const thread = new Thread({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
    });

    expect(thread.session.threadId).toBe(thread.threadId);
    expect(thread.session.sessionId).toBe(thread.sessionId);
    expect(thread.identity.rootThreadId).toBe(thread.threadId);
    expect(thread.settings).toEqual({ cwd: "/tmp", model: "test" });
  });

  it("子线程保留共享 sessionId，并记录父线程 lineage", () => {
    const root = new Thread({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
    });
    const child = new Thread({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
      sessionId: root.sessionId,
      parentThreadId: root.threadId,
      forkedFromThreadId: root.threadId,
    });

    expect(child.sessionId).toBe(root.sessionId);
    expect(child.threadId).not.toBe(root.threadId);
    expect(child.identity.parentThreadId).toBe(root.threadId);
    expect(child.identity.forkedFromThreadId).toBe(root.threadId);
    expect(child.identity.rootThreadId).toBe(root.sessionId);
  });

  it("ThreadManager 注册根线程，并为子线程维护 lineage", () => {
    const manager = new ThreadManager();
    const root = manager.createRoot({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
    });
    const child = manager.spawnChild(root, {
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
    });

    expect(manager.get(root.threadId)).toBe(root);
    expect(manager.get(child.threadId)).toBe(child);
    expect(manager.size).toBe(2);
    expect(child.sessionId).toBe(root.sessionId);
    expect(child.identity.parentThreadId).toBe(root.threadId);
    expect(child.identity.forkedFromThreadId).toBe(root.threadId);
  });

  it("ThreadManager 维护当前根线程，并按模板创建下一个根线程", () => {
    const manager = new ThreadManager();
    const options = {
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: idleClient(),
      handlers: [],
      emit: () => {},
    };
    const root = manager.createRoot(options);

    expect(manager.current()).toBe(root);
    expect(manager.currentThreadId).toBe(root.threadId);

    const next = manager.createRootLike();

    expect(next).not.toBe(root);
    expect(manager.current()).toBe(next);
    expect(manager.currentThreadId).toBe(next.threadId);
    expect(manager.size).toBe(2);
    expect(next.settings).toEqual(root.settings);
  });
});
