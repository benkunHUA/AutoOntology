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
  AgentControl,
  AgentPath,
  ApprovalGate,
  EventSink,
  HistoryItem,
  ModelClient,
  PermissionProfile,
  SandboxManager,
  SessionEvent,
  ThreadIdentity,
  ToolHandler,
  WaitAgentResult,
} from "@ao/protocol";
import type { SkillRuntime } from "@ao/skills";
import { newId } from "../util/id.ts";
import { join } from "node:path";
import { ContextManager } from "../context/context-manager.ts";
import { InputQueue } from "./input-queue.ts";
import type { AgentHooks } from "./hooks.ts";
import {
  SessionStore,
  loadSession,
  threadPersistencePath,
} from "../persistence/index.ts";
import type { TurnContext } from "./turn-context.ts";
import type { TurnResult } from "./turn.ts";
import {
  ContextCompactor,
  ToolResultStore,
  TranscriptArchive,
  type CompactionOutput,
} from "../compaction/index.ts";
import { AbortedError } from "../util/errors.ts";
import type { AbortReason } from "../util/errors.ts";
import { RegularTask } from "../tasks/regular.ts";
import type { SessionTask } from "../tasks/task.ts";
import {
  createSkillRuntime,
  createSkillToolHandlers,
  type SkillsOptions,
} from "../skills/skills.ts";
import { ToolRouter } from "../tools/router.ts";
import { WorldStateManager } from "../context/world-state.ts";

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
  persistence?: SessionStore;
  persistenceDir?: string;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
  skills?: SkillsOptions;
  identity?: ThreadIdentity;
  /** 已恢复的初始历史；由 Session.open 注入。 */
  initialHistory?: HistoryItem[];
  contextWindowNumber?: number;
  contextWindowId?: string;
  previousContextWindowId?: string;
  /** 压缩归档目录；缺省从 persistenceDir 或 cwd/.ao 推导。 */
  compactionDir?: string;
  /** 命令执行沙箱的权限基线；缺省由编排器按 cwd 推导。 */
  permissionProfile?: PermissionProfile;
  /** 共享 agent tree 控制面；注入后 subagent 工具可用。 */
  agentControl?: AgentControl;
  /** 本线程在 agent tree 中的路径。 */
  agentPath?: AgentPath;
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
  private readonly persistence: SessionStore | undefined;
  private readonly compactor: ContextCompactor;
  private active: ActiveTurn | null = null;
  private turnSeq = 0;
  private idleWaiters: Array<() => void> = [];
  private submissionTail: Promise<void> = Promise.resolve();
  private lastUserRequest = "";
  private contextWindowNumber: number;
  private contextWindowId: string;
  private previousContextWindowId: string | undefined;

  constructor(options: SessionOptions) {
    this.options = options;
    const threadId = options.identity?.threadId ?? newId();
    const { sessionId, rootThreadId, parentThreadId, forkedFromThreadId } = options.identity ?? {};
    this.identity = Object.freeze({
      threadId,
      sessionId: sessionId ?? newId(),
      rootThreadId: rootThreadId ?? sessionId ?? threadId,
      parentThreadId,
      forkedFromThreadId,
    });
    this.persistence = options.persistence ?? createStore(options, this.identity);
    this.contextWindowNumber = options.contextWindowNumber ?? 0;
    this.contextWindowId = options.contextWindowId ?? crypto.randomUUID();
    this.previousContextWindowId = options.previousContextWindowId;
    this.skillRuntime = createSkillRuntime(options.skills);
    this.router = new ToolRouter([
      ...options.handlers,
      ...(this.skillRuntime ? createSkillToolHandlers(this.skillRuntime) : []),
    ]);
    this.history = new ContextManager({
      onAppend: (item) => this.persistence?.append(item),
      initialItems: options.initialHistory,
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
    this.persistence?.appendSessionMeta({
      threadId: this.identity.threadId,
      sessionId: this.identity.sessionId,
      cwd: options.cwd,
    });
  }

  /** 从 canonical 会话文件恢复历史并创建会话。 */
  static async open(options: SessionOptions): Promise<Session> {
    const identity = options.identity ?? {
      threadId: newId(),
      sessionId: newId(),
      rootThreadId: newId(),
    };
    const store =
      options.persistence ??
      (options.persistenceDir
        ? new SessionStore(
            threadPersistencePath(
              options.persistenceDir,
              identity.sessionId,
              identity.threadId,
            ),
          )
        : undefined);
    if (!store) {
      return new Session(options);
    }
    const loaded = await loadSession(store.filePath);
    return new Session({
      ...options,
      identity,
      persistence: store,
      initialHistory: loaded.history,
      contextWindowNumber: loaded.window,
      contextWindowId: loaded.windowId || crypto.randomUUID(),
      previousContextWindowId: loaded.previousWindowId,
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

  get agentPath(): AgentPath {
    return this.options.agentPath ?? "/root";
  }

  visibleToolNames(): string[] {
    return this.router.modelVisibleSpecs().map((tool) => tool.name);
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
    const before = this.history.serialize();
    const output = await this.compactor.compactHistory(
      this.history.serialize(),
      this.currentRequest(),
      signal,
    );
    this.persistCompaction(output, before);
    this.history.replaceAll(output.items);
    this.worldState.resetBaseline();
    return { compacted: true };
  }

  /**
   * 队列型 agent 消息：与用户输入同队列，但不会启动空闲回合。
   * 忙碌回合会在下一采样步骤消费。
   */
  enqueueAgentMessage(text: string, sourcePath: string): void {
    this.inputQueue.enqueueAgentMessage(text, sourcePath);
  }

  /**
   * 等待本线程输入队列出现活动；供 wait_agent 工具使用。
   * agent 消息按 mailbox 计，用户插话按 steer 计，超时按 timeout 计。
   */
  async waitForPendingInput(
    signal: AbortSignal,
    timeoutMs: number,
    expectedSourcePath: string,
  ): Promise<WaitAgentResult> {
    if (signal.aborted) {
      throw signal.reason ?? new Error("aborted");
    }
    const queue = this.inputQueue;
    const waitStartIndex = queue.size;
    if (queue.findUserInput(waitStartIndex)) {
      return { message: "Wait completed.", timedOut: false, activity: "steer" };
    }
    const waitingAgent = queue.findAgentMessage(
      expectedSourcePath,
      waitStartIndex,
    );
    if (waitingAgent) {
      return {
        message: "Wait completed.",
        timedOut: false,
        activity: "mailbox",
        sourcePath: waitingAgent.sourcePath,
      };
    }

    const deadline = Date.now() + timeoutMs;
    return new Promise<WaitAgentResult>((resolve, reject) => {
      const unsubscribe = queue.subscribe(onActivity);
      const timeout = setTimeout(
        () => {
          cleanup();
          resolve({ message: "Wait timed out.", timedOut: true, activity: "timeout" });
        },
        timeoutMs,
      );
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new Error("aborted"));
      };

      const cleanup = () => {
        unsubscribe();
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      function onActivity(): void {
        if (signal.aborted) {
          onAbort();
          return;
        }
        if (Date.now() >= deadline) {
          cleanup();
          resolve({ message: "Wait timed out.", timedOut: true, activity: "timeout" });
          return;
        }
        if (queue.findUserInput(waitStartIndex)) {
          cleanup();
          resolve({ message: "Wait completed.", timedOut: false, activity: "steer" });
        } else {
          const agent = queue.findAgentMessage(
            expectedSourcePath,
            waitStartIndex,
          );
          if (!agent) return;
          cleanup();
          resolve({
            message: "Wait completed.",
            timedOut: false,
            activity: "mailbox",
            sourcePath: agent.sourcePath,
          });
        }
      }

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private persistCompaction(
    output: CompactionOutput,
    before: readonly HistoryItem[],
  ): void {
    if (!this.persistence) return;
    for (const event of output.events) {
      if (event.type === "item_rewrite") {
        this.persistence.appendRewrite(
          event.callId,
          event.reason,
          event.output,
          event.filePath,
        );
      } else if (event.type === "range_archive") {
        const start = this.history.ordinalOf(before[event.startIndex] as HistoryItem);
        const end = this.history.ordinalOf(before[event.endIndex] as HistoryItem);
        if (start === undefined || end === undefined) continue;
        this.persistence.appendArchive(
          start,
          end,
          event.archivePath,
          event.markerText,
        );
      } else if (event.type === "compaction") {
        this.previousContextWindowId = this.contextWindowId;
        this.contextWindowId = crypto.randomUUID();
        this.contextWindowNumber += 1;
        this.persistence.appendCheckpoint({
          window: this.contextWindowNumber,
          windowId: this.contextWindowId,
          previousWindowId: this.previousContextWindowId,
          summary: event.summary,
          replacementHistory: event.replacementHistory,
        });
      }
    }
  }

  // ── 内部：开单与收尾 ──────────────────────────────────────────

  private startTurn(text: string): void {
    const turnId = `turn_${++this.turnSeq}`;
    const startedAt = Date.now();
    const context: TurnContext = Object.freeze({
      threadId: this.identity.threadId,
      sessionId: this.identity.sessionId,
      turnId,
      agentPath: this.agentPath,
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
        agentControl: this.options.agentControl,
        worldState: this.worldState,
        compactor: this.compactor,
        persistCompaction: (output, before) =>
          this.persistCompaction(output, before),
        approval: this.options.approval,
        sandbox: this.options.sandbox,
        permissionProfile: this.options.permissionProfile,
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

function createStore(
  options: SessionOptions,
  identity: ThreadIdentity,
): SessionStore | undefined {
  if (options.persistence) return options.persistence;
  if (!options.persistenceDir) return undefined;
  return new SessionStore(
    threadPersistencePath(
      options.persistenceDir,
      identity.sessionId,
      identity.threadId,
    ),
  );
}
