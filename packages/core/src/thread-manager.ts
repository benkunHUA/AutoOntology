/**
 * Agent tree 的线程注册表。
 *
 * 根线程与子线程共享同一个 SessionId，各自拥有独立 ThreadId 和 Session。
 * 子 agent 工具接入后通过 spawnChild 在这里维护父子与 fork 关系。
 */
import type { ThreadId } from "@ao/protocol";
import { Thread, type ThreadOptions } from "./thread.ts";

export interface SpawnChildOptions
  extends Omit<ThreadOptions, "sessionId" | "parentThreadId" | "forkedFromThreadId"> {
  /** 缺省继承 parent.threadId；显式传入可表示更深层的 fork 来源。 */
  forkedFromThreadId?: ThreadId;
}

export class ThreadManager {
  private readonly threads = new Map<ThreadId, Thread>();
  private rootOptions: ThreadOptions | null = null;
  private currentId: ThreadId | null = null;

  createRoot(options: ThreadOptions): Thread {
    this.rootOptions = options;
    const thread = new Thread(options);
    this.threads.set(thread.threadId, thread);
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
    const child = new Thread({
      ...options,
      sessionId: parent.sessionId,
      parentThreadId: parent.threadId,
      forkedFromThreadId: options.forkedFromThreadId ?? parent.threadId,
    });
    this.threads.set(child.threadId, child);
    return child;
  }

  get(threadId: ThreadId): Thread | undefined {
    return this.threads.get(threadId);
  }

  get size(): number {
    return this.threads.size;
  }

  get currentThreadId(): ThreadId | undefined {
    return this.currentId ?? undefined;
  }

  current(): Thread | undefined {
    return this.currentId ? this.threads.get(this.currentId) : undefined;
  }
}
