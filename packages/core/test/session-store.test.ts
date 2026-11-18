import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@ao/protocol";
import { SessionStore, loadSession } from "../src/session-store.ts";
import { Session } from "../src/session.ts";

describe("SessionStore", () => {
  it("恢复 rewrite 与 range_archive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-store-"));
    const file = join(dir, "thread.jsonl");
    const store = new SessionStore(file);

    store.append({ type: "message", role: "user", text: "first" });
    store.append({
      type: "function_call_output",
      callId: "call-1",
      output: "large",
      ok: true,
    });
    store.append({ type: "message", role: "assistant", text: "last" });
    store.appendRewrite("call-1", "tool_result_preview", "preview");
    store.appendArchive(1, 2, "/tmp/archive.jsonl", "[1 messages archived at /tmp/archive.jsonl]");
    await store.flush();

    const loaded = await loadSession(file);
    expect(loaded.history).toEqual([
      { type: "message", role: "user", text: "first" },
      { type: "message", role: "user", text: "[1 messages archived at /tmp/archive.jsonl]" },
    ]);
  });

  it("恢复 rewrite / archive / checkpoint 后的最终历史", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-store-"));
    const file = join(dir, "thread.jsonl");
    const store = new SessionStore(file);

    store.appendSessionMeta({
      threadId: "t1",
      sessionId: "s1",
      cwd: "/tmp",
    });
    store.append({ type: "message", role: "user", text: "hello" });
    store.append({
      type: "function_call_output",
      callId: "call-1",
      output: "large output",
      ok: true,
    });
    store.appendRewrite(
      "call-1",
      "tool_result_preview",
      "<persisted-output>\nFull output: /tmp/call-1.txt\nPreview:\nlarge",
      "/tmp/call-1.txt",
    );
    store.append({
      type: "message",
      role: "assistant",
      text: "done",
    });
    store.appendArchive(1, 3, "/tmp/transcript.jsonl", "[2 messages archived at /tmp/transcript.jsonl]");
    store.appendCheckpoint({
      window: 1,
      windowId: "w1",
      previousWindowId: "w0",
      summary: "summary",
      replacementHistory: [
        { type: "message", role: "user", text: "[Compacted]\nsummary" },
      ],
    });
    store.append({ type: "message", role: "user", text: "after checkpoint" });
    await store.flush();

    const loaded = await loadSession(file);

    expect(loaded.window).toBe(1);
    expect(loaded.windowId).toBe("w1");
    expect(loaded.previousWindowId).toBe("w0");
    expect(loaded.history.map((item) => (item.type === "message" ? item.text : ""))).toEqual([
      "[Compacted]\nsummary",
      "after checkpoint",
    ]);
  });

  it("多次 checkpoint 时只恢复最新 checkpoint 及其尾部", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-store-"));
    const file = join(dir, "thread.jsonl");
    const store = new SessionStore(file);

    store.append({ type: "message", role: "user", text: "old" });
    store.appendCheckpoint({
      window: 1,
      windowId: "w1",
      summary: "first",
      replacementHistory: [{ type: "message", role: "user", text: "first summary" }],
    });
    store.append({ type: "message", role: "user", text: "middle" });
    store.appendCheckpoint({
      window: 2,
      windowId: "w2",
      previousWindowId: "w1",
      summary: "second",
      replacementHistory: [{ type: "message", role: "user", text: "second summary" }],
    });
    store.append({ type: "message", role: "assistant", text: "latest" });
    await store.flush();

    const loaded = await loadSession(file);

    expect(loaded.window).toBe(2);
    expect(loaded.windowId).toBe("w2");
    expect(loaded.history).toEqual([
      { type: "message", role: "user", text: "second summary" },
      { type: "message", role: "assistant", text: "latest" },
    ]);
  });

  it("Session.open 从 canonical 文件恢复历史", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-open-"));
    const root = join(dir, "sessions");
    const store = new SessionStore(join(root, "s1", "t1.jsonl"));
    store.append({ type: "message", role: "user", text: "remember" });
    store.appendCheckpoint({
      window: 1,
      windowId: "w1",
      summary: "sum",
      replacementHistory: [{ type: "message", role: "user", text: "[Compacted]\nsum" }],
    });
    await store.flush();

    const session = await Session.open({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: {
        id: "noop",
        async *stream() {},
      },
      handlers: [],
      emit: () => {},
      identity: {
        threadId: "t1",
        sessionId: "s1",
        rootThreadId: "s1",
      },
      persistenceDir: root,
    });

    expect(session.history.serialize()).toEqual([
      { type: "message", role: "user", text: "[Compacted]\nsum" },
    ]);
  });
});
