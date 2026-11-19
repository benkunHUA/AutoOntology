/**
 * Agent tree 的线程注册表与控制面。
 *
 * 根线程与子线程共享同一个 SessionId，各自拥有独立 ThreadId 和 Session。
 * 本类实现 protocol 的 `AgentControl`：负责 spawn、send、list、interrupt、
 * wait，以及父线程的完成通知。所有 agent 常驻内存，因此没有 Codex 的
 * residency/evict 概念；queue-only 消息直接进入目标线程的 InputQueue。
 */
import type {
  AgentCaller,
  AgentControl,
  AgentDeliveryReceipt,
  AgentPath,
  AgentSnapshot,
  AgentStatus,
  SendAgentRequest,
  SpawnAgentReceipt,
  SpawnAgentRequest,
  WaitAgentResult,
} from "@ao/protocol";
import {
  ROOT_AGENT_PATH,
  agentPathName,
  isValidAgentName,
  joinAgentPath,
  resolveAgentPath,
} from "../subagent/util/agent-path.ts";
import {
  formatAgentCompletion,
  formatAgentMessage,
} from "../subagent/util/agent-message.ts";
import type { SessionEvent } from "@ao/protocol";
import { Thread, type ThreadOptions } from "./thread.ts";

export interface SpawnChildOptions
  extends Omit<ThreadOptions, "sessionId" | "parentThreadId" | "forkedFromThreadId"> {
  /** 缺省继承 parent.threadId；显式传入可表示更深层的 fork 来源。 */
  forkedFromThreadId?: string;
}

export interface ThreadManagerOptions {
  /** 包含 root 在内的最大线程数。 */
  maxThreads?: number;
  /** 子 agent 的最大嵌套深度；root 为 0。 */
  maxDepth?: number;
}

export class ThreadManager implements AgentControl {
  private readonly threads = new Map<string, Thread>();
  private readonly paths = new Map<string, AgentPath>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly maxThreads: number;
  private readonly maxDepth: number;

  private rootOptions: ThreadOptions | null = null;
  private currentId: string | null = null;
  private childSequence = 0;

  constructor(options: ThreadManagerOptions = {}) {
    this.maxThreads = options.maxThreads ?? 9;
    this.maxDepth = options.maxDepth ?? 4;
  }

  createRoot(options: ThreadOptions): Thread {
    this.rootOptions = options;
    const thread = this.attach({
      ...options,
      agentPath: options.agentPath ?? ROOT_AGENT_PATH,
      agentRole: options.agentRole ?? "root",
      depth: options.depth ?? 0,
    });
    this.currentId = thread.threadId;
    return thread;
  }

  /** 按最近一次根线程配置再建一个根线程，并切换为当前线程。 */
  createRootLike(): Thread {
    if (!this.rootOptions) {
      throw new Error("没有可复用的根线程配置");
    }
    return this.createRoot(this.rootOptions);
  }

  spawnChild(parent: Thread, options: SpawnChildOptions): Thread {
    const childPath =
      options.agentPath ?? this.nextChildPath(parent.agentPath);
    if (this.paths.has(childPath)) {
      throw new Error(`agent path already exists: ${childPath}`);
    }
    if (this.threads.size >= this.maxThreads) {
      throw new Error(`agent limit reached (${this.maxThreads})`);
    }
    const depth = options.depth ?? parent.depth + 1;
    if (depth > this.maxDepth) {
      throw new Error(`agent depth limit reached (${this.maxDepth})`);
    }

    return this.attach({
      ...options,
      sessionId: parent.sessionId,
      parentThreadId: parent.threadId,
      forkedFromThreadId: options.forkedFromThreadId ?? parent.threadId,
      agentPath: childPath,
      agentRole: options.agentRole ?? "subagent",
      depth,
    });
  }

  get(threadId: string): Thread | undefined {
    return this.threads.get(threadId);
  }

  get size(): number {
    return this.threads.size;
  }

  get currentThreadId(): string | undefined {
    return this.currentId ?? undefined;
  }

  current(): Thread | undefined {
    return this.currentId ? this.threads.get(this.currentId) : undefined;
  }

  // ── AgentControl ──────────────────────────────────────────────────

  async spawn(
    caller: AgentCaller,
    request: SpawnAgentRequest,
  ): Promise<SpawnAgentReceipt> {
    const parent = this.requireThread(caller.threadId);
    if (request.message.trim() === "") {
      throw new Error("empty message can't be sent to an agent");
    }
    if (!isValidAgentName(request.taskName)) {
      throw new Error(`invalid agent name: ${request.taskName}`);
    }

    const agentPath = joinAgentPath(parent.agentPath, request.taskName);
    if (this.paths.has(agentPath)) {
      throw new Error(`agent path already exists: ${agentPath}`);
    }

    const inherited = parent.childOptions();
    const roleName = request.agentType?.trim();
    const role = roleName ? inherited.agentRoles?.[roleName] : undefined;
    const child = this.spawnChild(parent, {
      ...inherited,
      model: request.model ?? role?.model ?? parent.settings.model,
      instructions: role?.instructions ?? inherited.instructions,
      agentPath,
      agentRole: roleName || "subagent",
      depth: parent.depth + 1,
      initialHistory: request.forkHistory ? parent.history.serialize() : undefined,
    });

    const message = formatAgentMessage(
      caller.agentPath,
      child.agentPath,
      request.message,
    );
    await child.submit(message);

    return {
      threadId: child.threadId,
      agentPath: child.agentPath,
      nickname: agentPathName(child.agentPath),
      status: this.statuses.get(child.threadId) ?? "idle",
    };
  }

  async send(
    caller: AgentCaller,
    request: SendAgentRequest,
  ): Promise<AgentDeliveryReceipt> {
    if (request.message.trim() === "") {
      throw new Error("empty message can't be sent to an agent");
    }
    const { thread, path } = this.resolve(caller, request.target);
    if (request.mode === "trigger" && path === ROOT_AGENT_PATH) {
      throw new Error("followup_task can't target the root agent");
    }

    const message = formatAgentMessage(caller.agentPath, path, request.message);
    if (request.mode === "queue") {
      thread.session.enqueueAgentMessage(message, caller.agentPath);
    } else {
      await thread.submit(message);
    }

    return {
      threadId: thread.threadId,
      agentPath: path,
      status: this.statuses.get(thread.threadId) ?? "idle",
      submissionId: crypto.randomUUID(),
    };
  }

  list(caller: AgentCaller, pathPrefix?: string): Promise<AgentSnapshot[]> {
    const prefix = pathPrefix
      ? resolveAgentPath(caller.agentPath, pathPrefix)
      : ROOT_AGENT_PATH;
    const snapshots = [...this.threads.values()]
      .filter((thread) => this.matchesPrefix(thread.agentPath, prefix))
      .map((thread) => this.snapshot(thread))
      .sort((left, right) => left.agentPath.localeCompare(right.agentPath));
    return Promise.resolve(snapshots);
  }

  async interrupt(
    caller: AgentCaller,
    target: string,
  ): Promise<AgentSnapshot | null> {
    const { thread } = this.resolve(caller, target);
    if (thread.threadId === caller.threadId) {
      throw new Error("cannot interrupt self");
    }
    await thread.abort("user");
    return this.snapshot(thread);
  }

  async waitForActivity(
    caller: AgentCaller,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<WaitAgentResult> {
    return this.requireThread(caller.threadId).session.waitForPendingInput(
      signal,
      timeoutMs,
    );
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  private attach(options: ThreadOptions): Thread {
    const sink = options.emit;
    const thread = new Thread(
      options,
      {
        ...options,
        emit: (event) => this.observe(thread, event, sink),
      },
    );
    this.threads.set(thread.threadId, thread);
    this.paths.set(thread.agentPath, thread.threadId);
    this.statuses.set(thread.threadId, "idle");
    return thread;
  }

  private observe(
    thread: Thread,
    event: SessionEvent,
    sink: (event: SessionEvent) => void,
  ): void {
    this.trackStatus(thread, event);
    if (thread.identity.parentThreadId) {
      this.notifyParent(thread, event);
    }
    sink(event);
  }

  private trackStatus(thread: Thread, event: SessionEvent): void {
    switch (event.type) {
      case "turn_started":
        this.statuses.set(thread.threadId, "running");
        break;
      case "turn_completed":
        this.statuses.set(thread.threadId, "completed");
        break;
      case "turn_aborted":
        this.statuses.set(thread.threadId, "interrupted");
        break;
      case "turn_error":
        this.statuses.set(thread.threadId, "errored");
        break;
      default:
        break;
    }
  }

  private notifyParent(thread: Thread, event: SessionEvent): void {
    const parent = this.threads.get(thread.identity.parentThreadId!);
    if (!parent) return;

    let message: string | null = null;
    if (event.type === "turn_completed") {
      message = formatAgentCompletion(thread.agentPath, event.finalMessage);
    } else if (event.type === "turn_aborted") {
      message = `[agent ${thread.agentPath} interrupted]`;
    } else if (event.type === "turn_error") {
      message = `[agent ${thread.agentPath} errored] ${event.message}`;
    }
    if (message) {
      parent.session.enqueueAgentMessage(message, thread.agentPath);
    }
  }

  private resolve(
    caller: AgentCaller,
    target: string,
  ): { thread: Thread; path: AgentPath } {
    if (this.threads.has(target)) {
      const thread = this.requireThread(target);
      return { thread, path: thread.agentPath };
    }
    const path = resolveAgentPath(caller.agentPath, target);
    const threadId = this.paths.get(path);
    if (!threadId) {
      throw new Error(`agent not found: ${target}`);
    }
    return { thread: this.requireThread(threadId), path };
  }

  private requireThread(threadId: string): Thread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`agent not found: ${threadId}`);
    return thread;
  }

  private snapshot(thread: Thread): AgentSnapshot {
    return {
      threadId: thread.threadId,
      agentPath: thread.agentPath,
      nickname: agentPathName(thread.agentPath),
      role: thread.agentRole,
      depth: thread.depth,
      status: this.statuses.get(thread.threadId) ?? "idle",
    };
  }

  private nextChildPath(parentPath: AgentPath): AgentPath {
    const sequence = ++this.childSequence;
    return joinAgentPath(parentPath, `child_${sequence}`);
  }

  private matchesPrefix(path: AgentPath, prefix: AgentPath): boolean {
    if (prefix === ROOT_AGENT_PATH) return true;
    return path === prefix || path.startsWith(`${prefix}/`);
  }
}
