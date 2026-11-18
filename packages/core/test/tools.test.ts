import { describe, expect, it } from "vitest";
import { ToolError } from "@ao/protocol";
import type {
  FunctionCallItem,
  Approvable,
  ToolHandler,
  ToolResult,
  ToolRuntime,
  SandboxManager,
} from "@ao/protocol";
import { captureStepContext } from "../src/step-context.ts";
import { ReadWriteGate } from "../src/tools/gate.ts";
import { ToolOrchestrator } from "../src/tools/orchestrator.ts";
import { ToolRouter } from "../src/tools/router.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { ToolCallRuntime } from "../src/tools/runtime.ts";
import { SandboxDeniedError } from "../src/tools/sandbox.ts";

function call(name: string, id = "call_1", args = "{}"): FunctionCallItem {
  return { type: "function_call", callId: id, name, arguments: args };
}

function noopHandler(name: string, spec: Partial<ToolHandler["spec"]> = {}): ToolHandler {
  return {
    spec: { name, description: name, parameters: {}, ...spec },
    async execute() {
      return { ok: true, output: `${name}:done` };
    },
  };
}

function approvalRequirement(requirement: Approvable["execApprovalRequirement"]): Approvable {
  return {
    execApprovalRequirement: requirement,
    approvalAction: () => "test action",
  };
}

const UNAVAILABLE_SANDBOX: SandboxManager = {
  available: false,
  run: async () => {
    throw new Error("unreachable");
  },
};

describe("ToolRouter", () => {
  it("隐藏工具不进模型说明书", () => {
    const router = new ToolRouter([
      noopHandler("visible"),
      noopHandler("secret", { exposure: "hidden" }),
    ]);
    expect(router.modelVisibleSpecs().map((t) => t.name)).toEqual(["visible"]);
  });

  it("codeModeOnly 不进模型说明书", () => {
    const router = new ToolRouter([
      noopHandler("visible"),
      noopHandler("nested", { exposure: "codeModeOnly" }),
    ]);
    expect(router.modelVisibleSpecs().map((t) => t.name)).toEqual(["visible"]);
  });

  it("未知工具与非法参数都解析为失败结果", () => {
    const router = new ToolRouter([noopHandler("known")]);
    expect(router.resolve(call("ghost")).failure?.output).toContain(
      "unknown tool",
    );
    expect(router.resolve(call("known", "call_2", "{bad")).failure?.output).toContain(
      "invalid tool arguments",
    );
  });

  it("构造后继续注册工具不影响已编译快照", () => {
    const registry = new ToolRegistry();
    registry.registerTrusted(noopHandler("a"));
    const router = new ToolRouter(registry);
    registry.registerTrusted(noopHandler("b"));
    expect(router.modelVisibleSpecs().map((tool) => tool.name)).toEqual(["a"]);
  });
});

describe("ToolOrchestrator", () => {
  it("超时按失败结果回填", async () => {
    const slow: ToolRuntime = {
      async run(_args, ctx) {
        await new Promise<ToolResult>((_, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => reject(ctx.signal.reason ?? new Error("aborted")),
            { once: true },
          );
        });
        return { ok: true, output: "never" };
      },
    };
    const deadline = AbortSignal.timeout(20);
    const result = await new ToolOrchestrator().run(slow, {}, {
      cwd: "/tmp",
      signal: deadline,
      toolName: "slow",
      callId: "call_1",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("timed out");
  });

  it("fatal 向上抛，普通异常隔离为失败结果", async () => {
    const fatal: ToolRuntime = {
      async run() {
        throw new ToolError("fatal", "protocol broken");
      },
    };
    await expect(
      new ToolOrchestrator().run(fatal, {}, {
        cwd: "/tmp",
        signal: new AbortController().signal,
        toolName: "fatal",
        callId: "call_1",
      }),
    ).rejects.toThrow(ToolError);

    const recoverable: ToolRuntime = {
      async run() {
        throw new Error("io down");
      },
    };
    const result = await new ToolOrchestrator().run(recoverable, {}, {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "recoverable",
      callId: "call_1",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("recoverable failed");
  });

  it("截断时上报历史层限额", async () => {
    const big: ToolRuntime = {
      async run() {
        return { ok: true, output: "x".repeat(20_000) };
      },
    };
    const result = await new ToolOrchestrator().run(big, {}, {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "big",
      callId: "call_1",
    });
    expect(result.output.length).toBeLessThan(20_000);
    expect(result.fallbackTokenLimitOverride).toBe(16_000);
    expect(result.output.length).toBeLessThanOrEqual(16_000);
  });

  it("审批未通过时不执行，通过后执行", async () => {
    const runtime: ToolRuntime = {
      approvable: approvalRequirement(() => "needs_approval"),
      async run() {
        return { ok: true, output: "ran" };
      },
    };
    const ctx = {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "gated",
      callId: "call_1",
    };

    const denied = await new ToolOrchestrator({
      approval: { request: async () => false },
    }).run(runtime, {}, ctx);
    expect(denied.output).toContain("not approved");

    const allowed = await new ToolOrchestrator({
      approval: { request: async () => true },
    }).run(runtime, {}, ctx);
    expect(allowed).toEqual({ ok: true, output: "ran" });
  });

  it("sandboxed 工具在沙箱不可用时 fail-closed", async () => {
    const runtime: ToolRuntime = {
      sandboxable: {
        sandboxPreference: () => "sandboxed",
        escalateOnFailure: () => true,
      },
      async run() {
        return { ok: true, output: "should not run" };
      },
    };
    const result = await new ToolOrchestrator({
      sandbox: UNAVAILABLE_SANDBOX,
    }).run(runtime, {}, {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "sandboxed",
      callId: "call_1",
    });
    expect(result.output).toContain("sandbox unavailable");
  });

  it("needs_human_approval 会在审批请求里标记 requiresHuman", async () => {
    const requests: Array<{ requiresHuman?: boolean }> = [];
    const runtime: ToolRuntime = {
      approvable: approvalRequirement(() => "needs_human_approval"),
      async run() {
        return { ok: true, output: "ran" };
      },
    };
    await new ToolOrchestrator({
      approval: {
        request: async (request) => {
          requests.push(request);
          return true;
        },
      },
    }).run(runtime, {}, {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "human",
      callId: "call_1",
    });
    expect(requests[0]?.requiresHuman).toBe(true);
  });

  it("沙箱拒绝后经升级审批可重试一次", async () => {
    let runs = 0;
    const requests: string[] = [];
    const runtime: ToolRuntime = {
      sandboxable: {
        sandboxPreference: () => "sandboxed",
        escalateOnFailure: () => true,
      },
      approvable: approvalRequirement(() => "needs_approval"),
      async run(_args, ctx) {
        runs++;
        if (!ctx.sandboxOverride) {
          throw new SandboxDeniedError("denied by seatbelt");
        }
        return { ok: true, output: "escalated" };
      },
    };
    const result = await new ToolOrchestrator({
      approval: {
        request: async (request) => {
          requests.push(request.action);
          return true;
        },
      },
      sandbox: {
        available: true,
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
    }).run(runtime, {}, {
      cwd: "/tmp",
      signal: new AbortController().signal,
      toolName: "escalate",
      callId: "call_1",
    });
    expect(runs).toBe(2);
    expect(result).toEqual({ ok: true, output: "escalated" });
    expect(requests[1]).toContain("retry unsandboxed");
  });
});

describe("ToolCallRuntime", () => {
  const testTurn = {
    threadId: "thread_1",
    sessionId: "session_1",
    turnId: "turn_1",
    cwd: "/tmp",
    model: "test",
    instructions: "",
    startedAt: 0,
  };

  it("默认路径重复 callId 不保证去重，执行两次且不崩溃", async () => {
    let executions = 0;
    const probe: ToolHandler = {
      spec: { name: "probe", description: "", parameters: {}, supportsParallel: true },
      async execute() {
        executions++;
        return { ok: true, output: "done" };
      },
    };
    const router = new ToolRouter([probe]);
    const step = captureStepContext({
      turn: testTurn,
      cwd: "/tmp",
      signal: new AbortController().signal,
      router,
      gate: new ReadWriteGate(),
      stepIndex: 1,
    });
    const runtime = new ToolCallRuntime(
      step,
      router,
      new ToolOrchestrator(),
      () => {},
      undefined,
    );

    runtime.dispatch(call("probe"));
    runtime.dispatch(call("probe"));
    const collected = await runtime.collect();

    expect(executions).toBe(2);
    expect(collected).toHaveLength(2);
  });

  it("未知工具不发 started，只发 finished", async () => {
    const router = new ToolRouter([noopHandler("known")]);
    const events: string[] = [];
    const step = captureStepContext({
      turn: testTurn,
      cwd: "/tmp",
      signal: new AbortController().signal,
      router,
      gate: new ReadWriteGate(),
      stepIndex: 1,
    });
    const runtime = new ToolCallRuntime(
      step,
      router,
      new ToolOrchestrator(),
      (event) => events.push(event.type),
      undefined,
    );

    runtime.dispatch(call("ghost"));
    await runtime.collect();

    expect(events).not.toContain("tool_started");
    expect(events).toContain("tool_finished");
  });

  it("deadline 覆盖排队等待，锁未释放也会超时", async () => {
    const slow = noopHandler("slow", { timeoutMs: 20 });
    const router = new ToolRouter([slow]);
    const gate = new ReadWriteGate();
    const step = captureStepContext({
      turn: testTurn,
      cwd: "/tmp",
      signal: new AbortController().signal,
      router,
      gate,
      stepIndex: 1,
    });
    const release = await gate.acquireWrite();
    const runtime = new ToolCallRuntime(
      step,
      router,
      new ToolOrchestrator(),
      () => {},
      undefined,
    );

    const startedAt = Date.now();
    runtime.dispatch(call("slow"));
    setTimeout(() => release(), 80);
    const collected = await runtime.collect();

    expect(Date.now() - startedAt).toBeLessThan(80);
    expect(collected[0].result.output).toContain("timed out");
  });

  it("matchesKind 为 false 时 fatal 终止收集", async () => {
    const mismatched: ToolHandler = {
      spec: { name: "mismatched", description: "", parameters: {} },
      matchesKind: () => false,
      async execute() {
        return { ok: true, output: "should not run" };
      },
    };
    const router = new ToolRouter([mismatched]);
    const step = captureStepContext({
      turn: testTurn,
      cwd: "/tmp",
      signal: new AbortController().signal,
      router,
      gate: new ReadWriteGate(),
      stepIndex: 1,
    });
    const runtime = new ToolCallRuntime(
      step,
      router,
      new ToolOrchestrator(),
      () => {},
      undefined,
    );

    runtime.dispatch(call("mismatched"));
    await expect(runtime.collect()).rejects.toThrow(ToolError);
  });

  it("取消时发 tool_aborted，且不发 tool_finished", async () => {
    const controller = new AbortController();
    const waiting: ToolHandler = {
      spec: { name: "waiting", description: "", parameters: {}, supportsParallel: true },
      execute: (_args, ctx) =>
        new Promise<ToolResult>((_, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => reject(ctx.signal.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
    };
    const router = new ToolRouter([waiting]);
    const events: string[] = [];
    const step = captureStepContext({
      turn: testTurn,
      cwd: "/tmp",
      signal: controller.signal,
      router,
      gate: new ReadWriteGate(),
      stepIndex: 1,
    });
    const runtime = new ToolCallRuntime(
      step,
      router,
      new ToolOrchestrator(),
      (event) => events.push(event.type),
      undefined,
    );

    runtime.dispatch(call("waiting"));
    setTimeout(() => controller.abort(new Error("cancelled")), 10);
    await runtime.collect();

    expect(events).toContain("tool_started");
    expect(events).toContain("tool_aborted");
    expect(events).not.toContain("tool_finished");
  });
});
