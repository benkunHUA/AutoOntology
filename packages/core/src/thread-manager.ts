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

  createRoot(options: ThreadOptions): Thread {
    const thread = new Thread(options);
    this.threads.set(thread.threadId, thread);
    return thread;
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
}
