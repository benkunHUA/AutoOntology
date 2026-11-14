/**
 * 会话。
 *
 * 唯一串行入口：submit() 内部没有任何 await，判断与状态变更
 * 在一个同步段内完成；回合本身作为后台 promise 运行。任何时刻同一会话
 * 最多一个活跃任务，新输入要么插话进队列，要么被拒绝，要么在空闲时开新单。
 *
 * 终止统一路径：
 *   判结局 → 取剩余输入 → 补中断标记/缺失工具结果 → 落盘 → 发终止事件
 *   → 清空活跃任务 → 有待处理输入则立即开下一单
 */
import type {
  ApprovalGate,
  EventSink,
  ModelClient,
  SandboxManager,
  SessionEvent,
  ToolHandler,
} from "@ao/protocol";
import type { SkillRuntime } from "@ao/skills";
import { message } from "@ao/protocol";
import { ContextManager } from "./context-manager.ts";
import { InputQueue } from "./input-queue.ts";
import type { AgentHooks } from "./hooks.ts";
import type { JsonlPersistence } from "./persistence.ts";
import type { TurnContext } from "./turn-context.ts";
import type { TurnResult } from "./turn.ts";
import { AbortedError } from "./errors.ts";
import type { AbortReason } from "./errors.ts";
import { RegularTask } from "./tasks/regular.ts";
import type { SessionTask } from "./tasks/task.ts";
import {
  createSkillRuntime,
  createSkillToolHandlers,
  type SkillsOptions,
} from "./skills.ts";
import { ToolRouter } from "./tools/router.ts";

export type SubmissionMode = "start-or-steer" | "start-if-idle" | "steer";
export type SubmitResult = "started" | "steered" | "rejected";

export interface SessionOptions {
  cwd: string;
  model: string;
  instructions: string;
  client: ModelClient;
  handlers: ToolHandler[];
  emit: EventSink;
  hooks?: AgentHooks;
  persistence?: JsonlPersistence;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
  skills?: SkillsOptions;
}

interface TurnStats {
  firstTokenAt: number | null;
  toolCalls: number;
}

interface ActiveTurn {
  context: TurnContext;
  controller: AbortController;
  task: SessionTask;
  done: Promise<void>;
  startedAt: number;
  stats: TurnStats;
}

/** 取消第二档：给正常收手留 100ms。 */
const GRACE_MS = 100;

export class Session {
  readonly history: ContextManager;
  readonly inputQueue = new InputQueue();

  private readonly options: SessionOptions;
  private readonly router: ToolRouter;
  private readonly skillRuntime: SkillRuntime | null;
  private active: ActiveTurn | null = null;
  private turnSeq = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(options: SessionOptions) {
    this.options = options;
    this.skillRuntime = createSkillRuntime(options.skills);
    this.router = new ToolRouter([
      ...options.handlers,
      ...(this.skillRuntime ? createSkillToolHandlers(this.skillRuntime) : []),
    ]);
    this.history = new ContextManager({
      onAppend: (item) => options.persistence?.append(item),
    });
  }

  get isBusy(): boolean {
    return this.active !== null;
  }

  /**
   * 唯一的串行提交入口。同步完成状态判定（不能在内部 await）。
   */
  submit(text: string, mode: SubmissionMode = "start-or-steer"): SubmitResult {
    if (this.active) {
      if (mode === "start-if-idle") return "rejected";
      // start-or-steer / steer：插话进入待处理队列，步骤边界消费
      this.inputQueue.push(text);
      return "steered";
    }
    if (mode === "steer") return "rejected";
    this.startTurn(text);
    return "started";
  }

  /**
   * 取消当前回合。分档语义：取消令牌 → 最多等 100ms → 后续由任务
   * 自身在观察点退出（Node 无强杀线程的能力，第三档体现为放弃等待、
   * 由 done 落地后统一收尾）。
   */
  async abort(reason: AbortReason = "user"): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (!active.controller.signal.aborted) {
      active.controller.abort(new AbortedError(reason));
    }
    await Promise.race([active.done, sleep(GRACE_MS)]);
  }

  /** 等待会话空闲（CLI 退出、测试收口用）。 */
  whenIdle(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ── 内部：开单与收尾 ──────────────────────────────────────────

  private startTurn(text: string): void {
    const turnId = `turn_${++this.turnSeq}`;
    const startedAt = Date.now();
    const context: TurnContext = Object.freeze({
      turnId,
      cwd: this.options.cwd,
      model: this.options.model,
      instructions: this.options.instructions,
      startedAt,
    });
    const controller = new AbortController();

    this.emit({ type: "turn_started", turnId, at: new Date().toISOString() });
    this.history.append(message("user", text));

    const active: ActiveTurn = {
      context,
      controller,
      task: new RegularTask(),
      done: Promise.resolve(),
      startedAt,
      stats: { firstTokenAt: null, toolCalls: 0 },
    };

    active.done = this.runTask(active, text).finally(() => this.onTaskFinished(active));
    this.active = active;
  }

  private async runTask(active: ActiveTurn, initialText: string): Promise<void> {
    try {
      const result = await active.task.run({
        turn: active.context,
        history: this.history,
        inputQueue: this.inputQueue,
        client: this.options.client,
        router: this.router,
        emit: (event) => this.emitForTurn(event, active),
        hooks: this.options.hooks,
        signal: active.controller.signal,
        approval: this.options.approval,
        sandbox: this.options.sandbox,
        skills: this.skillRuntime
          ? { runtime: this.skillRuntime, initialText }
          : undefined,
      });
      this.pendingResult = result;
    } catch (error) {
      this.pendingError = error;
    }
  }

  private pendingResult: TurnResult | null = null;
  private pendingError: unknown = null;

  private async onTaskFinished(active: ActiveTurn): Promise<void> {
    const { context, controller, startedAt, stats } = active;
    const durationMs = Date.now() - startedAt;
    const aborted = controller.signal.aborted;
    const error = this.pendingError;
    const result = this.pendingResult;
    this.pendingError = null;
    this.pendingResult = null;

    // 1. 判定结局（收工第 1 步）
    let outcome: "completed" | "aborted" | "error" = "completed";
    if (aborted) outcome = "aborted";
    else if (error) outcome = "error";

    // 2. 中断/出错时先回填缺失的工具结果：function_call 后必须紧跟 output。
    if (outcome === "aborted") {
      this.history.backfillMissingToolOutputs("turn aborted");
    } else if (outcome === "error") {
      this.history.backfillMissingToolOutputs("turn errored");
    }

    // 3. 剩余输入与中断标记在回填之后落账，不能夹在 call 与 output 之间。
    const remaining = this.inputQueue.drain();
    for (const pending of remaining) {
      this.history.append(message("user", pending.text));
    }

    if (outcome === "aborted") {
      const reason =
        controller.signal.reason instanceof AbortedError
          ? controller.signal.reason.reason
          : "error";
      this.history.append({
        type: "turn_marker",
        kind: "aborted",
        detail: `turn aborted (${reason})`,
        at: new Date().toISOString(),
      });
    } else if (outcome === "error") {
      this.history.append({
        type: "turn_marker",
        kind: "error",
        detail: (error as Error)?.message ?? String(error),
        at: new Date().toISOString(),
      });
    }

    // 4. 先落盘，再发终止事件
    await this.options.persistence?.flush();

    if (outcome === "completed") {
      this.emit({
        type: "turn_completed",
        turnId: context.turnId,
        finalMessage: result?.finalMessage ?? null,
        usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
        durationMs,
        firstTokenMs:
          stats.firstTokenAt === null ? null : stats.firstTokenAt - startedAt,
        toolCalls: stats.toolCalls,
      });
    } else if (outcome === "aborted") {
      const reason =
        controller.signal.reason instanceof AbortedError
          ? controller.signal.reason.reason
          : "error";
      this.emit({ type: "turn_aborted", turnId: context.turnId, reason, durationMs });
    } else {
      this.emit({
        type: "turn_error",
        turnId: context.turnId,
        message: (error as Error)?.message ?? String(error),
      });
    }

    this.options.hooks?.onTurnEnd?.(outcome);

    // 4. 清空活跃任务，置空闲；有待处理输入则立即开下一单
    this.active = null;
    if (this.inputQueue.hasPending()) {
      const next = this.inputQueue.drain()[0];
      if (next) this.startTurn(next.text);
      return;
    }
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** 包一层 emit：在本回合事件流上统计首字延迟与工具次数，其余透传。 */
  private emitForTurn(event: SessionEvent, active: ActiveTurn): void {
    if (event.type === "text_delta" || event.type === "reasoning_delta") {
      active.stats.firstTokenAt ??= Date.now();
    } else if (event.type === "tool_started") {
      active.stats.toolCalls++;
    }
    this.emit(event);
  }

  private emit(event: SessionEvent): void {
    this.options.emit(event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
