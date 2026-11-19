import { describe, expect, it } from "vitest";
import type {
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
  ToolContext,
} from "@ao/protocol";
import { ThreadManager } from "../src/engine/thread-manager.ts";
import type { ThreadOptions } from "../src/engine/thread.ts";
import { createSubagentToolHandlers } from "../src/subagent/index.ts";

function idleClient(finalMessage: string): ModelClient {
  return {
    id: "idle",
    async *stream(
      _request: ModelRequest,
      _options: StreamOptions,
    ): AsyncGenerator<ResponseEvent> {
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: finalMessage },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function rootOptions(manager: ThreadManager): ThreadOptions {
  return {
    cwd: "/tmp",
    model: "test",
    instructions: "",
    client: idleClient("root done"),
    handlers: [],
    emit: () => {},
    agentControl: manager,
    agentPath: "/root",
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("ThreadManager subagent control", () => {
  it("spawn 创建子线程、启动工作，并把完成结果队列化给父线程", async () => {
    const manager = new ThreadManager();
    const root = manager.createRoot({
      ...rootOptions(manager),
      client: idleClient("worker done"),
    });

    const receipt = await manager.spawn(
      {
        threadId: root.threadId,
        sessionId: root.sessionId,
        agentPath: root.agentPath,
      },
      { taskName: "worker", message: "do work" },
    );

    const child = manager.get(receipt.threadId);
    expect(child).toBeDefined();
    expect(receipt.agentPath).toBe("/root/worker");
    expect(child!.agentRole).toBe("subagent");
    expect(child!.depth).toBe(1);
    expect(child!.sessionId).toBe(root.sessionId);

    await child!.whenIdle();

    const snapshots = await manager.list(
      {
        threadId: root.threadId,
        sessionId: root.sessionId,
        agentPath: root.agentPath,
      },
    );
    expect(snapshots.map((agent) => agent.agentPath)).toEqual([
      "/root",
      "/root/worker",
    ]);
    expect(snapshots.find((agent) => agent.agentPath === "/root/worker")!.status).toBe(
      "completed",
    );
    expect(snapshots.find((agent) => agent.agentPath === "/root")!.status).toBe(
      "idle",
    );
    expect(root.inputQueue.hasAgentMessage()).toBe(true);
  });

  it("send_message 只入队，followup_task 唤醒目标且禁止指向 root", async () => {
    const manager = new ThreadManager();
    const root = manager.createRoot({
      ...rootOptions(manager),
      client: idleClient("worker done"),
    });
    const caller = {
      threadId: root.threadId,
      sessionId: root.sessionId,
      agentPath: root.agentPath,
    };
    const receipt = await manager.spawn(caller, {
      taskName: "worker",
      message: "initial",
    });
    const child = manager.get(receipt.threadId)!;
    await child.whenIdle();

    await manager.send(caller, {
      target: "worker",
      message: "queued",
      mode: "queue",
    });
    expect(child.isBusy).toBe(false);
    expect(child.session.inputQueue.hasAgentMessage()).toBe(true);

    await manager.send(caller, {
      target: "worker",
      message: "wake",
      mode: "trigger",
    });
    await child.whenIdle();

    await expect(
      manager.send(caller, {
        target: "/root",
        message: "root",
        mode: "trigger",
      }),
    ).rejects.toThrow("root");
  });

  it("waitForActivity 区分 agent 邮箱消息与用户插话", async () => {
    const manager = new ThreadManager();
    const root = manager.createRoot(rootOptions(manager));
    const caller = {
      threadId: root.threadId,
      sessionId: root.sessionId,
      agentPath: root.agentPath,
    };
    const signal = new AbortController().signal;

    const mailboxWait = manager.waitForActivity(caller, 1_000, signal);
    root.inputQueue.enqueueAgentMessage("completed", "/root/worker");
    await expect(mailboxWait).resolves.toMatchObject({ activity: "mailbox" });
    root.inputQueue.drain();

    const steerWait = manager.waitForActivity(caller, 1_000, signal);
    root.inputQueue.push("steer");
    await expect(steerWait).resolves.toMatchObject({ activity: "steer" });
  });

  it("agent_type 可应用 role 级 model 覆盖", async () => {
    const manager = new ThreadManager();
    const root = manager.createRoot({
      ...rootOptions(manager),
      agentRoles: {
        explorer: { model: "explorer-model" },
      },
    });
    const caller = {
      threadId: root.threadId,
      sessionId: root.sessionId,
      agentPath: root.agentPath,
    };

    const receipt = await manager.spawn(caller, {
      taskName: "explorer",
      message: "explore",
      agentType: "explorer",
    });
    expect(manager.get(receipt.threadId)!.settings.model).toBe("explorer-model");
  });
});

describe("subagent tools through runTurn", () => {
  it("root 模型调用 spawn_agent 后完成整条链路", async () => {
    let calls = 0;
    const scripted: ModelClient = {
      id: "scripted",
      async *stream(
        request: ModelRequest,
        _options: StreamOptions,
      ): AsyncGenerator<ResponseEvent> {
        calls++;
        const hasAgentMessage = request.input.some(
          (item) =>
            item.type === "message" &&
            item.text.includes("[agent /root → /root/worker]"),
        );
        const hasSpawnCall = request.input.some(
          (item) => item.type === "function_call" && item.name === "spawn_agent",
        );

        if (hasAgentMessage) {
          yield { type: "item_started", index: 0 };
          yield {
            type: "item_done",
            index: 0,
            item: { type: "message", role: "assistant", text: "child done" },
          };
          yield {
            type: "response_completed",
            needsContinue: false,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
          return;
        }

        if (hasSpawnCall) {
          yield { type: "item_started", index: 0 };
          yield {
            type: "item_done",
            index: 0,
            item: { type: "message", role: "assistant", text: "parent done" },
          };
          yield {
            type: "response_completed",
            needsContinue: false,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
          return;
        }

        yield { type: "item_started", index: 0 };
        yield {
          type: "item_done",
          index: 0,
          item: {
            type: "function_call",
            callId: "call_spawn",
            name: "spawn_agent",
            arguments: JSON.stringify({
              task_name: "worker",
              message: "do work",
            }),
          },
        };
        yield {
          type: "response_completed",
          needsContinue: false,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };

    const manager = new ThreadManager();
    const root = manager.createRoot({
      cwd: "/tmp",
      model: "test",
      instructions: "",
      client: scripted,
      handlers: createSubagentToolHandlers(),
      emit: () => {},
      agentControl: manager,
      agentPath: "/root",
    });

    await root.submit("make a worker");
    await root.whenIdle();
    const children = await manager.list({
      threadId: root.threadId,
      sessionId: root.sessionId,
      agentPath: root.agentPath,
    });
    const child = children.find((agent) => agent.agentPath === "/root/worker");

    expect(child).toBeDefined();
    expect(child!.status).toBe("completed");
    await waitFor(() =>
      root.history
        .serialize()
        .some(
          (item) =>
            item.type === "message" &&
            item.text.includes("[agent /root/worker completed]"),
        ),
    );
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe("subagent tool handlers", () => {
  it("spawn_agent 从 ToolContext 取 AgentControl", async () => {
    const manager = new ThreadManager();
    const root = manager.createRoot(rootOptions(manager));
    const handler = createSubagentToolHandlers().find(
      (tool) => tool.spec.name === "spawn_agent",
    )!;
    const ctx = {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "spawn_agent",
      callId: "call_1",
      agentControl: manager,
      agentCaller: {
        threadId: root.threadId,
        sessionId: root.sessionId,
        agentPath: root.agentPath,
      },
      orchestrator: {
        run: () => {
          throw new Error("not used");
        },
      },
    } as unknown as ToolContext;

    const result = await handler.execute(
      { task_name: "worker", message: "go" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({ agentPath: "/root/worker" });
  });
});
