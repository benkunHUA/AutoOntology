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
  ThreadIdentity,
  ToolHandler,
} from "@ao/protocol";
import type { SkillRuntime } from "@ao/skills";
import { newSessionId, newThreadId } from "@ao/protocol";
import { join } from "node:path";
import { ContextManager } from "./context-manager.ts";
import { InputQueue } from "./input-queue.ts";
import type { AgentHooks } from "./hooks.ts";
import {
  JsonlPersistence,
  threadPersistencePath,
} from "./persistence.ts";
import type { TurnContext } from "./turn-context.ts";
import type { TurnResult } from "./turn.ts";
import {
  ContextCompactor,
  ToolResultStore,
  TranscriptArchive,
} from "./compaction/index.ts";
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
import { WorldStateManager } from "./world-state.ts";

export type SubmissionMode =
  | "start-or-steer"
  | "start-if-idle"
  | "continue-if-idle"
  | "steer";
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
  persistenceDir?: string;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
  skills?: SkillsOptions;
  identity?: ThreadIdentity;
  /** 压缩归档目录；缺省从 persistenceDir 或 cwd/.ao 推导。 */
  compactionDir?: string;
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
  readonly worldState = new WorldStateManager();
  readonly identity: ThreadIdentity;

  private readonly options: SessionOptions;
  private readonly router: ToolRouter;
  private readonly skillRuntime: SkillRuntime | null;
  private readonly persistence: JsonlPersistence | undefined;
  private readonly compactor: ContextCompactor;
  private active: ActiveTurn | null = null;
  private turnSeq = 0;
  private idleWaiters: Array<() => void> = [];
  private submissionTail: Promise<void> = Promise.resolve();
  private lastUserRequest = "";

  constructor(options: SessionOptions) {
    this.options = options;
    const threadId = options.identity?.threadId ?? newThreadId();
    const { sessionId, rootThreadId, parentThreadId, forkedFromThreadId } = options.identity ?? {};
    this.identity = Object.freeze({
      threadId,
      sessionId: sessionId ?? newSessionId(),
      rootThreadId: rootThreadId ?? sessionId ?? threadId,
      parentThreadId,
      forkedFromThreadId,
    });
    this.persistence = createPersistence(options, this.identity);
    this.skillRuntime = createSkillRuntime(options.skills);
    this.router = new ToolRouter([
      ...options.handlers,
      ...(this.skillRuntime ? createSkillToolHandlers(this.skillRuntime) : []),
    ]);
    this.history = new ContextManager({
      onAppend: (item) => this.persistence?.append(item),
    });
    const compactionDir = resolveCompactionDir(options);
    this.compactor = new ContextCompactor({
      client: options.client,
      model: options.model,
      archive: new TranscriptArchive({
        dir: join(compactionDir, "transcripts"),
      }),
      results: new ToolResultStore({
        dir: join(compactionDir, "tool-results"),
      }),
    });
  }

  get isBusy(): boolean {
    return this.active !== null;
  }

  get threadId(): string {
    return this.identity.threadId;
  }

  get sessionId(): string {
    return this.identity.sessionId;
  }

  /**
   * 唯一的串行提交入口。提交按到达顺序串行处理，避免并发写状态。
   */
  async submit(
    text: string,
    mode: SubmissionMode = "start-or-steer",
  ): Promise<SubmitResult> {
    let outcome: SubmitResult = "rejected";
    const operation = this.submissionTail.then(() => {
      outcome = this.dispatchSubmission(text, mode);
    });
    // 后续提交继续排在本操作之后，单次失败不阻断队列。
    this.submissionTail = operation.catch(() => {});
    await operation;
    return outcome;
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

  /** 空闲时手动压缩当前历史；忙碌时直接返回未压缩。 */
  async compact(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ compacted: boolean; summary?: string }> {
    if (this.active) return { compacted: false };
    const compacted = await this.compactor.compactHistory(
      this.history.serialize(),
      this.currentRequest(),
      signal,
    );
    this.history.replaceAll(compacted);
    this.worldState.resetBaseline();
    return { compacted: true };
  }

  // ── 内部：开单与收尾 ──────────────────────────────────────────

  private startTurn(text: string): void {
    const turnId = `turn_${++this.turnSeq}`;
    const startedAt = Date.now();
    const context: TurnContext = Object.freeze({
      threadId: this.identity.threadId,
      sessionId: this.identity.sessionId,
      turnId,
      cwd: this.options.cwd,
      model: this.options.model,
      instructions: this.options.instructions,
      startedAt,
    });
    const controller = new AbortController();

    this.emit({ type: "turn_started", turnId, at: new Date().toISOString() });

    const active: ActiveTurn = {
      context,
      controller,
      task: new RegularTask(),
      done: Promise.resolve(),
      startedAt,
      stats: { firstTokenAt: null, toolCalls: 0 },
    };

    active.done = this.runTask(active, text);
    this.active = active;
  }

  private async runTask(
    active: ActiveTurn,
    initialText: string,
  ): Promise<void> {
    let result: TurnResult | null = null;
    let error: unknown = null;
    try {
      result = await active.task.run({
        turn: active.context,
        initialText,
        history: this.history,
        inputQueue: this.inputQueue,
        client: this.options.client,
        router: this.router,
        emit: (event) => this.emitForTurn(event, active),
        hooks: this.options.hooks,
        signal: active.controller.signal,
        worldState: this.worldState,
        compactor: this.compactor,
        approval: this.options.approval,
        sandbox: this.options.sandbox,
        skills: this.skillRuntime
          ? { runtime: this.skillRuntime }
          : undefined,
      });
    } catch (caught) {
      error = caught;
    }
    await this.onTaskFinished(active, result, error);
  }

  private async onTaskFinished(
    active: ActiveTurn,
    result: TurnResult | null,
    error: unknown,
  ): Promise<void> {
    const { context, controller, startedAt, stats } = active;
    const durationMs = Date.now() - startedAt;
    const aborted = controller.signal.aborted;

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
    await this.persistence?.flush();

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
      const next = this.inputQueue.takeFirst();
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

  private currentRequest(): string {
    return this.lastUserRequest;
  }

  private dispatchSubmission(
    text: string,
    mode: SubmissionMode,
  ): SubmitResult {
    if (this.active) {
      const active = this.active;
      if (mode === "start-if-idle") return "rejected";
      if (mode === "steer") {
        if (active.task.kind !== "regular") return "rejected";
        this.inputQueue.push(text);
        this.lastUserRequest = text;
        return "steered";
      }
      // start-or-steer：仅普通回合可插话，评审/压缩回合拒绝。
      if (active.task.kind !== "regular") return "rejected";
      this.inputQueue.push(text);
      this.lastUserRequest = text;
      return "steered";
    }
    if (mode === "steer") return "rejected";
    // continue-if-idle 用于内部续接，行为等同空闲时开新单。
    this.lastUserRequest = text;
    this.startTurn(text);
    return "started";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCompactionDir(options: SessionOptions): string {
  if (options.compactionDir) return options.compactionDir;
  if (options.persistenceDir) return join(options.persistenceDir, "compaction");
  return join(options.cwd, ".ao", "compaction");
}

function createPersistence(
  options: SessionOptions,
  identity: ThreadIdentity,
): JsonlPersistence | undefined {
  if (options.persistence) return options.persistence;
  if (!options.persistenceDir) return undefined;
  return new JsonlPersistence(
    threadPersistencePath(
      options.persistenceDir,
      identity.sessionId,
      identity.threadId,
    ),
  );
}
