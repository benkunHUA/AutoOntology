import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  HistoryItem,
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";
import {
  ContextCompactor,
  ToolResultStore,
  TranscriptArchive,
} from "../src/compaction/index.ts";

function summaryClient(summary: string): ModelClient {
  return {
    id: "summary",
    async *stream(
      _request: ModelRequest,
      _options: StreamOptions,
    ): AsyncGenerator<ResponseEvent> {
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

function historyWithUsers(count: number, chars = 100): HistoryItem[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "message",
    role: "user",
    text: `message-${i}:${"x".repeat(chars)}`,
  }));
}

describe("ToolResultStore", () => {
  it("保存并解析可读回路径", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-tool-"));
    const store = new ToolResultStore({ dir });
    const saved = await store.save("tool/1", "full output");
    expect(await readFile(saved, "utf8")).toBe("full output");

    const placeholder = await store.persistedPreview("tool/1", "full output", 2);
    expect(await store.resolvePlaceholder(placeholder)).toBe(saved);
  });
});

describe("TranscriptArchive", () => {
  it("写入 JSONL 并校验 marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-transcript-"));
    const archive = new TranscriptArchive({ dir });
    const path = await archive.write(historyWithUsers(2));
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2);
    expect(
      await archive.isMarker({
        type: "message",
        role: "user",
        text: `[1 messages archived at ${path}]`,
      }),
    ).toBe(true);
  });
});

describe("ContextCompactor", () => {
  it("小历史 prepare 后保持不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    const input = historyWithUsers(2);
    const output = await compactor.prepare(input, "hello", new AbortController().signal);
    expect(output.items).toEqual(input);
    expect(output.events).toEqual([]);
  });

  it("超大最新工具批次会持久化为占位文本", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    const input: HistoryItem[] = [
      {
        type: "function_call",
        callId: "call",
        name: "read",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        callId: "call",
        output: "x".repeat(31_000),
        ok: true,
      },
    ];
    const output = await compactor.toolResultBudget(input, 10);
    expect(output.items[1]).toMatchObject({
      type: "function_call_output",
      output: expect.stringContaining("<persisted-output>"),
    });
  });

  it("超长历史中段被归档为 marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    const input = historyWithUsers(55);
    const output = await compactor.snipCompact(input);
    expect(output.items.length).toBeLessThan(input.length);
    const marker = output.items.find(
      (item) =>
        item.type === "message" &&
        /messages archived at /.test(item.text),
    );
    expect(marker).toBeDefined();
  });

  it("兜底摘要替换整段历史", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    const output = await compactor.compactHistory(
      historyWithUsers(3),
      "current request",
      new AbortController().signal,
    );
    expect(output.items).toHaveLength(1);
    expect(output.items[0]).toMatchObject({
      type: "message",
      role: "user",
      text: expect.stringContaining("[Compacted]"),
    });
    expect(output.items[0].type === "message" && output.items[0].text).toContain(
      "final summary",
    );
  });

  it("reactive 保留最近消息并前置摘要", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    const output = await compactor.reactive(
      historyWithUsers(10),
      "current request",
      new AbortController().signal,
    );
    expect(output.items[0]).toMatchObject({
      type: "message",
      role: "user",
      text: expect.stringContaining("[Reactive compact]"),
    });
    expect(output.items).toHaveLength(6);
  });

  it("识别上下文超限错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-compactor-"));
    const compactor = makeCompactor(dir);
    expect(compactor.isPromptTooLong(new Error("prompt_too_long"))).toBe(true);
    expect(compactor.isPromptTooLong(new Error("too many tokens"))).toBe(true);
  });
});

function makeCompactor(dir: string): ContextCompactor {
  return new ContextCompactor({
    client: summaryClient("final summary"),
    model: "test",
    archive: new TranscriptArchive({ dir: join(dir, "transcripts") }),
    results: new ToolResultStore({ dir: join(dir, "tool-results") }),
  });
}
