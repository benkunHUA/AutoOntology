import { describe, expect, it } from "vitest";
import { ThreadManager, type Thread } from "@ao/core";
import type {
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";
import {
  SlashCommandDispatcher,
  discoverSlashCommands,
  parseSlashCommand,
  type CommandHost,
  type CommandThread,
  type SlashCommandContext,
} from "../src/index.ts";

function summaryClient(summary: string): ModelClient {
  return {
    id: "summary",
    async *stream(
      _request: ModelRequest,
      _options: StreamOptions,
    ): AsyncGenerator<ResponseEvent> {
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

function rootThread(client: ModelClient): { manager: ThreadManager; thread: Thread } {
  const manager = new ThreadManager();
  const thread = manager.createRoot({
    cwd: "/tmp",
    model: "test",
    instructions: "",
    client,
    handlers: [],
    emit: () => {},
  });
  return { manager, thread };
}

function contextOf(manager: ThreadManager, thread: Thread): SlashCommandContext {
  return { threadId: thread.threadId, host: manager };
}

describe("slash command model", () => {
  it("discovers the built-in lifecycle and compact commands", () => {
    const registry = discoverSlashCommands();

    expect(registry.list().map((command) => command.name)).toEqual([
      "quit",
      "abort",
      "new",
      "compact",
    ]);
    expect(registry.find("compact")).toMatchObject({
      name: "compact",
      description: "压缩对话上下文，避免达到上下文上限",
    });
  });

  it("resolves a command alias during discovery", () => {
    const registry = discoverSlashCommands();

    expect(registry.find("compress")?.name).toBe("compact");
    expect(registry.find("missing")).toBeUndefined();
  });
});

describe("slash command dispatcher", () => {
  it("parses a command name and inline args", () => {
    expect(parseSlashCommand("/compact")).toEqual({ name: "compact", args: "" });
    expect(parseSlashCommand("/compact extra words")).toEqual({
      name: "compact",
      args: "extra words",
    });
    expect(parseSlashCommand("plain input")).toBeNull();
  });

  it("dispatches and executes the compact command", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));
    thread.history.append({ type: "message", role: "user", text: "remember this" });

    const result = await dispatcher.dispatch("/compact", contextOf(manager, thread));

    expect(result).toEqual({ ok: true, output: "上下文已压缩。" });
  });

  it("dispatches and executes the quit command", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));

    const result = await dispatcher.dispatch("/quit", contextOf(manager, thread));

    expect(result).toEqual({ ok: true, output: "已退出。", exit: true });
  });

  it("dispatches and executes the abort command when idle", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));

    const result = await dispatcher.dispatch("/abort", contextOf(manager, thread));

    expect(result).toEqual({ ok: true, output: "（空闲中）" });
  });

  it("dispatches and executes the new-thread command", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));

    const result = await dispatcher.dispatch("/new", contextOf(manager, thread));

    expect(result).toEqual({ ok: true, output: "已新建会话。" });
    expect(manager.currentThreadId).not.toBe(thread.threadId);
    expect(manager.current()).toBe(manager.get(manager.currentThreadId!));
  });

  it("rejects unknown commands", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));

    const result = await dispatcher.dispatch("/nope", contextOf(manager, thread));

    expect(result).toEqual({ ok: false, output: "未知斜杠命令：/nope" });
  });

  it("rejects inline args for commands that do not support them", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const { manager, thread } = rootThread(summaryClient("condensed conversation"));

    const result = await dispatcher.dispatch(
      "/compact now",
      contextOf(manager, thread),
    );

    expect(result).toEqual({
      ok: false,
      output: "/compact 不支持参数",
    });
  });

  it("rejects commands that are unavailable while a task is running", async () => {
    const dispatcher = new SlashCommandDispatcher(discoverSlashCommands());
    const host: CommandHost = {
      get: () => ({ isBusy: true } as CommandThread),
      createRootLike: () => {},
    };

    const result = await dispatcher.dispatch(
      "/compact",
      { threadId: "thread-1", host },
    );

    expect(result).toEqual({
      ok: false,
      output: "/compact 在任务进行中不可用",
    });
  });
});
