/**
 * Agent tree 契约。
 *
 * 工具层与引擎层都只依赖这里的接口：模型可见的 subagent 工具只调用
 * `AgentControl`，不知道线程管理器如何实现。与 Codex 一致，spawn/send 的
 * 成功只代表「已被接受」，不代表目标线程已经读完消息。
 */

export type AgentPath = string;
export type AgentDeliveryMode = "queue" | "trigger";

export type AgentStatus =
  | "idle"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "not_found";

export interface AgentCaller {
  readonly threadId: string;
  readonly sessionId: string;
  readonly agentPath: AgentPath;
}

export interface SpawnAgentRequest {
  readonly taskName: string;
  readonly message: string;
  readonly agentType?: string;
  readonly model?: string;
  /** 是否继承父线程历史；false 时子线程从空历史开始。 */
  readonly forkHistory?: boolean;
}

export interface AgentRoleConfig {
  readonly instructions?: string;
  readonly model?: string;
}

export interface SpawnAgentReceipt {
  readonly threadId: string;
  readonly agentPath: AgentPath;
  readonly nickname: string;
  readonly status: AgentStatus;
}

export interface SendAgentRequest {
  readonly target: string;
  readonly message: string;
  readonly mode: AgentDeliveryMode;
}

export interface AgentDeliveryReceipt {
  readonly threadId: string;
  readonly agentPath: AgentPath;
  readonly status: AgentStatus;
  readonly submissionId: string;
}

export interface AgentSnapshot {
  readonly threadId: string;
  readonly agentPath: AgentPath;
  readonly nickname: string;
  readonly role: string;
  readonly depth: number;
  readonly status: AgentStatus;
}

export type WaitAgentActivity = "mailbox" | "steer" | "timeout";

export interface WaitAgentResult {
  readonly message: string;
  readonly timedOut: boolean;
  readonly activity: WaitAgentActivity;
}

export interface AgentControl {
  spawn(
    caller: AgentCaller,
    request: SpawnAgentRequest,
  ): Promise<SpawnAgentReceipt>;

  send(
    caller: AgentCaller,
    request: SendAgentRequest,
  ): Promise<AgentDeliveryReceipt>;

  list(caller: AgentCaller, pathPrefix?: string): Promise<AgentSnapshot[]>;

  interrupt(
    caller: AgentCaller,
    target: string,
  ): Promise<AgentSnapshot | null>;

  waitForActivity(
    caller: AgentCaller,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<WaitAgentResult>;
}


