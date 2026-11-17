/**
 * Thread 门面。
 *
 * 每个 root / child agent 对应一个 Thread；Thread 拥有身份与跨回合设置，
 * 内部持有一个 Session 作为该线程的执行引擎。后续多 agent 能力由
 * ThreadManager 在这个门面上管理父子关系、mailbox 与并发准入。
 */
import type {
  SessionId,
  ThreadId,
  ThreadIdentity,
  ThreadSettings,
} from "@ao/protocol";
import { newSessionId, newThreadId } from "@ao/protocol";
import type { Session, SessionOptions } from "./session.ts";
import { Session as SessionEngine } from "./session.ts";

export interface ThreadOptions
  extends Omit<SessionOptions, "identity"> {
  threadId?: ThreadId;
  sessionId?: SessionId;
  parentThreadId?: ThreadId;
  forkedFromThreadId?: ThreadId;
}

export class Thread {
  readonly identity: ThreadIdentity;
  readonly settings: ThreadSettings;
  readonly session: Session;

  constructor(options: ThreadOptions) {
    const threadId = options.threadId ?? newThreadId();
    this.identity = Object.freeze({
      threadId,
      sessionId: options.sessionId ?? newSessionId(),
      rootThreadId: options.sessionId ?? threadId,
      parentThreadId: options.parentThreadId,
      forkedFromThreadId: options.forkedFromThreadId,
    });
    this.settings = Object.freeze({
      cwd: options.cwd,
      model: options.model,
    });
    this.session = new SessionEngine({ ...options, identity: this.identity });
  }

  get threadId(): ThreadId {
    return this.identity.threadId;
  }

  get sessionId(): SessionId {
    return this.identity.sessionId;
  }

  get history(): Session["history"] {
    return this.session.history;
  }

  get isBusy(): boolean {
    return this.session.isBusy;
  }

  submit(text: string, mode?: Parameters<Session["submit"]>[1]): ReturnType<Session["submit"]> {
    return this.session.submit(text, mode);
  }

  abort(reason?: Parameters<Session["abort"]>[0]): ReturnType<Session["abort"]> {
    return this.session.abort(reason);
  }

  whenIdle(): ReturnType<Session["whenIdle"]> {
    return this.session.whenIdle();
  }
}
