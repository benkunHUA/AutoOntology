/**
 * Thread 与 Session 的身份模型。
 *
 * SessionId 是一棵 agent tree 共享的根身份；ThreadId 唯一标识根线程或
 * 某个子 agent。每个 Thread 都拥有独立的 Session 执行引擎。
 */

export type ThreadId = string;
export type SessionId = string;

export interface ThreadIdentity {
  readonly threadId: ThreadId;
  /** 根线程与所有后代线程共享；根线程通常等于 threadId。 */
  readonly sessionId: SessionId;
  readonly rootThreadId: ThreadId;
  readonly parentThreadId?: ThreadId;
  readonly forkedFromThreadId?: ThreadId;
}

/** 可持久化、跨回合继承的线程设置快照。 */
export interface ThreadSettings {
  readonly cwd: string;
  readonly model: string;
}

export function newThreadId(): ThreadId {
  return crypto.randomUUID();
}

export function newSessionId(): SessionId {
  return crypto.randomUUID();
}
