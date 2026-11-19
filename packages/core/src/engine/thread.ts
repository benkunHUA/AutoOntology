/**
 * Thread 门面。
 *
 * 每个 root / child agent 对应一个 Thread；Thread 拥有身份与跨回合设置，
 * 内部持有一个 Session 作为该线程的执行引擎。后续多 agent 能力由
 * ThreadManager 在这个门面上管理父子关系、mailbox 与并发准入。
 */
import type {
  AgentRoleConfig,
  SessionId,
  ThreadId,
  ThreadIdentity,
  ThreadSettings,
  AgentPath,
} from "@ao/protocol";
import { newId } from "../util/id.ts";
import { ROOT_AGENT_PATH } from "../subagent/util/agent-path.ts";
import type { Session, SessionOptions } from "./session.ts";
import { Session as SessionEngine } from "./session.ts";

export interface ThreadOptions
  extends Omit<SessionOptions, "identity"> {
  threadId?: ThreadId;
  sessionId?: SessionId;
  parentThreadId?: ThreadId;
  forkedFromThreadId?: ThreadId;
  agentPath?: AgentPath;
  agentRole?: string;
  depth?: number;
  agentRoles?: Record<string, AgentRoleConfig>;
}

export class Thread {
  readonly identity: ThreadIdentity;
  readonly settings: ThreadSettings;
  readonly session: Session;
  readonly agentPath: AgentPath;
  readonly agentRole: string;
  readonly depth: number;

  private readonly options: ThreadOptions;

  constructor(options: ThreadOptions, sessionOptions: ThreadOptions = options) {
    this.options = options;
    const threadId = options.threadId ?? newId();
    this.identity = Object.freeze({
      threadId,
      sessionId: options.sessionId ?? newId(),
      rootThreadId: options.sessionId ?? threadId,
      parentThreadId: options.parentThreadId,
      forkedFromThreadId: options.forkedFromThreadId,
    });
    this.agentPath = options.agentPath ?? ROOT_AGENT_PATH;
    this.agentRole = options.agentRole ?? "root";
    this.depth = options.depth ?? 0;
    this.settings = Object.freeze({
      cwd: sessionOptions.cwd,
      model: sessionOptions.model,
    });
    this.session = new SessionEngine({
      ...sessionOptions,
      identity: this.identity,
      agentPath: this.agentPath,
    });
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

  get inputQueue(): Session["inputQueue"] {
    return this.session.inputQueue;
  }

  /** 克隆本线程的启动配置，供子线程继承后再覆盖。 */
  childOptions(overrides: Partial<ThreadOptions> = {}): ThreadOptions {
    return { ...this.options, ...overrides };
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

  compact(signal?: AbortSignal): ReturnType<Session["compact"]> {
    return this.session.compact(signal);
  }
}
