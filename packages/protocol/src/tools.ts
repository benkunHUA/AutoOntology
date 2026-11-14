/**
 * 工具层契约。
 *
 * 工具实现（@ao/tools）与工具调度（@ao/core）都依赖这里的接口，
 * 避免 core ↔ tools 循环依赖。
 *
 * 执行契约也放在 protocol，与 ToolHandler 一样作为共享接口。
 */

/**
 * 工具暴露面。注册期决定，编译期可能再裁剪。
 * direct 进入说明书；codeModeOnly 仅嵌套代码可调（当前不进入模型说明书）；
 * deferred 留待搜索工具；
 * hidden 永不暴露。
 */
export type ToolExposure = "direct" | "deferred" | "codeModeOnly" | "hidden";

export type SandboxPreference = "default" | "unsandboxed" | "sandboxed";

export type SandboxPermissions =
  | "use_default"
  | "no_override"
  | "bypass_sandbox_first_attempt"
  | "escalated_sandbox_with_restrictions";

export type ApprovalPolicy = "never" | "on_request" | "granular" | "unless_trusted";

export type ExecApprovalRequirement =
  | "skip"
  | "needs_approval"
  | "needs_human_approval"
  | "forbidden";

/** 下发给模型的工具声明。 */
export interface ToolSpec {
  name: string;
  /** 命名空间；缺省等价于默认命名空间 functions。 */
  namespace?: string;
  description: string;
  /** JSON Schema。 */
  parameters: Record<string, unknown>;
  /**
   * 是否声明可并行。
   * 只有「多次并发调用互不影响且不写共享状态」的只读工具才允许为 true；
   * 未声明 = 独占写锁，执行期间其他工具排队。
   */
  supportsParallel?: boolean;
  /** 进入模型说明书的暴露面，默认 direct。 */
  exposure?: ToolExposure;
  /** 本次调用的 deadline（毫秒），未声明时使用宿主默认值。 */
  timeoutMs?: number;
}

/** 执行体上下文：编排器驱动 ToolRuntime 时的最小现场。 */
export interface ToolExecutionContext {
  cwd: string;
  signal: AbortSignal;
  toolName: string;
  callId: string;
  sandbox?: SandboxManager;
  sandboxOverride?: "unsandboxed";
}

/** Handler 上下文：在 ToolExecutionContext 上附加主动调用编排器的入口。 */
export interface ToolContext extends ToolExecutionContext {
  readonly orchestrator: ToolOrchestrator;
}

export interface ToolResult {
  ok: boolean;
  /** 写回历史的输出文本（会被截断到合理长度）。 */
  output: string;
  /**
   * 输出被工具自行截断时必须上报：历史层应使用的截断上限。
   * 未截断时为 undefined。
   */
  fallbackTokenLimitOverride?: number;
  /**
   * 输出含外部上下文（网页/仓库/MCP 内容）时为 true，
   * 用于 disable_on_external_context 的记忆污染判定。
   */
  containsExternalContext?: boolean;
}

/** 模型侧 Handler 接口。 */
export interface ToolHandler {
  readonly spec: ToolSpec;
  /**
   * Handler 入口：决定「能不能调」。有副作用的工具必须在这里
   * 主动调用 ctx.orchestrator.run(runtime, args, ctx)，不在分发层统一调用。
   */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;

  /** 载荷形态校验，默认放行。 */
  matchesKind?(args: Record<string, unknown>): boolean;

  /** 工具自定义遥测标签。 */
  telemetryTags?(args: Record<string, unknown>): Record<string, string>;
}

export interface Sandboxable {
  sandboxPreference(): SandboxPreference;
  escalateOnFailure(): boolean;
}

export interface Approvable {
  sandboxPermissions(args: Record<string, unknown>): SandboxPermissions;
  shouldBypassApproval(policy: ApprovalPolicy, alreadyApproved: boolean): boolean;
  execApprovalRequirement(
    args: Record<string, unknown>,
  ): ExecApprovalRequirement | undefined;
  wantsNoSandboxApproval(policy: ApprovalPolicy): boolean;
  approvalAction(args: Record<string, unknown>, callId: string): string;
}

export interface ToolRuntime {
  readonly sandboxable?: Sandboxable;
  readonly approvable?: Approvable;
  run(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult>;
}

export interface ToolOrchestrator {
  run(
    runtime: ToolRuntime,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult>;
}

export interface ApprovalRequest {
  toolName: string;
  callId: string;
  action: string;
  requiresHuman?: boolean;
  escalated?: boolean;
}

export interface ApprovalGate {
  request(request: ApprovalRequest): Promise<boolean>;
}

export interface SandboxCommandOptions {
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxBuffer: number;
}

export interface SandboxedCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed?: boolean;
}

export interface SandboxManager {
  readonly available: boolean;
  run(
    command: string,
    args: string[],
    options: SandboxCommandOptions,
  ): Promise<SandboxedCommandResult>;
}

/**
 * 工具层错误的两种出口。
 * - respond_to_model：可自纠错误，转成工具结果回填历史。
 * - fatal：协议级错误，终止整轮且不产出结果。
 */
export type ToolErrorKind = "respond_to_model" | "fatal";

export class ToolError extends Error {
  readonly kind: ToolErrorKind;

  constructor(kind: ToolErrorKind, message: string) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
  }
}
