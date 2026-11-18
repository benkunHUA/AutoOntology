/**
 * 工具编排：审批 → 沙箱选择 → 执行 → 沙箱拒绝后的升级重试。
 *
 * 编排器由 Handler 在 execute 内主动调用，而不是分发层统一包装。
 * 升级语义与 demo/codex-rs 对齐：denied-read 存在时升级必须保留沙箱。
 */
import { ToolError } from "@ao/protocol";
import type {
  ApprovalGate,
  PermissionProfile,
  SandboxManager,
  SandboxOverride,
  SandboxType,
  ToolExecutionContext,
  ToolOrchestrator as ToolOrchestratorContract,
  ToolResult,
  ToolRuntime,
} from "@ao/protocol";
import {
  SandboxDeniedError,
  unsandboxedExecutionAllowed,
} from "@ao/sandbox";

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 16_000;

export interface ToolOrchestratorOptions {
  defaultTimeoutMs?: number;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
  permissionProfile?: PermissionProfile;
}

export class ToolOrchestrator implements ToolOrchestratorContract {
  private readonly configuredDefaultTimeoutMs: number;
  private readonly approval: ApprovalGate | undefined;
  private readonly sandbox: SandboxManager | undefined;
  private readonly permissionProfile: PermissionProfile | undefined;

  constructor(options: ToolOrchestratorOptions = {}) {
    const { defaultTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS } = options;
    this.configuredDefaultTimeoutMs =
      defaultTimeoutMs > 0 ? defaultTimeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
    this.approval = options.approval;
    this.sandbox = options.sandbox;
    this.permissionProfile = options.permissionProfile;
  }

  get defaultTimeoutMs(): number {
    return this.configuredDefaultTimeoutMs;
  }

  effectiveTimeoutMs(declared?: number): number {
    return declared !== undefined && declared > 0
      ? declared
      : this.configuredDefaultTimeoutMs;
  }

  async run(
    runtime: ToolRuntime,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const policy = this.permissionProfile ?? workspacePermissionProfile(ctx.cwd);
    const requirement =
      runtime.approvable?.execApprovalRequirement(args) ?? "skip";
    const action =
      runtime.approvable?.approvalAction(args, ctx.callId) ?? ctx.toolName;

    if (requirement === "forbidden") {
      return { ok: false, output: `tool ${ctx.toolName} is forbidden` };
    }
    if (
      requirement === "needs_approval" ||
      requirement === "needs_human_approval"
    ) {
      const decision = this.approval
        ? await this.approval.request({
            toolName: ctx.toolName,
            callId: ctx.callId,
            action,
            requiresHuman: requirement === "needs_human_approval",
          })
        : "denied";
      if (decision === "denied") {
        return { ok: false, output: `tool ${ctx.toolName} was not approved` };
      }
    }

    const preference = runtime.sandboxable?.sandboxPreference() ?? "auto";
    const permissions =
      runtime.approvable?.sandboxPermissions(args) ?? "use_default";
    const sandboxRequested =
      this.sandbox?.shouldSandbox(preference, policy) ?? false;
    const override = firstAttemptOverride(permissions, policy);
    const sandboxType = sandboxTypeFor(
      this.sandbox,
      sandboxRequested,
      override,
    );
    const needsSandbox = sandboxRequested && override !== "bypass_first_attempt";
    if (needsSandbox && !this.sandbox?.available) {
      return {
        ok: false,
        output: `sandbox unavailable for ${ctx.toolName}`,
      };
    }

    try {
      const result = await runtime.run(args, {
        ...ctx,
        sandbox: this.sandbox,
        sandboxPolicy: policy,
        sandboxType,
        sandboxOverride: override,
      });
      return normalizeOutput(result);
    } catch (error) {
      if (
        error instanceof SandboxDeniedError &&
        runtime.sandboxable?.escalateOnFailure() !== false
      ) {
        return this.retryEscalated(runtime, args, ctx, policy, action);
      }
      return this.normalizeError(error, ctx);
    }
  }

  private async retryEscalated(
    runtime: ToolRuntime,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    policy: PermissionProfile,
    action: string,
  ): Promise<ToolResult> {
    const override = unsandboxedExecutionAllowed(policy.filesystem)
      ? "bypass_first_attempt"
      : "escalated_with_restrictions";
    const needsSandbox = override === "escalated_with_restrictions";
    if (needsSandbox && !this.sandbox?.available) {
      return {
        ok: false,
        output: `tool ${ctx.toolName} requires a sandbox for escalation, but none is available`,
      };
    }

    const decision = this.approval
      ? await this.approval.request({
          toolName: ctx.toolName,
          callId: ctx.callId,
          action: `${action} (retry ${override})`,
          requiresHuman: true,
          escalated: true,
        })
      : "denied";
    if (decision === "denied") {
      return {
        ok: false,
        output: `tool ${ctx.toolName} escalation was not approved`,
      };
    }

    try {
      const result = await runtime.run(args, {
        ...ctx,
        sandbox: this.sandbox,
        sandboxPolicy: policy,
        sandboxType: needsSandbox ? this.sandbox?.type ?? "none" : "none",
        sandboxOverride: override,
      });
      return normalizeOutput(result);
    } catch (error) {
      return this.normalizeError(error, ctx);
    }
  }

  private normalizeError(
    error: unknown,
    ctx: ToolExecutionContext,
  ): ToolResult {
    if (error instanceof ToolError && error.kind === "fatal") throw error;
    if (ctx.signal.aborted || isAbortError(error)) {
      if (isTimeout(ctx.signal) || isTimeoutError(error)) {
        return { ok: false, output: `tool ${ctx.toolName} timed out` };
      }
      return { ok: false, output: "tool aborted" };
    }
    if (error instanceof ToolError) {
      return { ok: false, output: error.message };
    }
    return {
      ok: false,
      output: `tool ${ctx.toolName} failed: ${(error as Error).message}`,
    };
  }
}

export function workspacePermissionProfile(cwd: string): PermissionProfile {
  return {
    filesystem: {
      kind: "restricted",
      writableRoots: [cwd],
      deniedReads: [],
    },
    network: { enabled: false },
  };
}

function firstAttemptOverride(
  permissions:
    | "use_default"
    | "require_escalated"
    | "with_additional_permissions",
  policy: PermissionProfile,
): SandboxOverride {
  if (permissions === "require_escalated") {
    return unsandboxedExecutionAllowed(policy.filesystem)
      ? "bypass_first_attempt"
      : "escalated_with_restrictions";
  }
  return "no_override";
}

function sandboxTypeFor(
  sandbox: SandboxManager | undefined,
  sandboxRequested: boolean,
  override: SandboxOverride,
): SandboxType {
  if (!sandboxRequested || override === "bypass_first_attempt") return "none";
  return sandbox?.type ?? "none";
}

/** 输出截断：写回历史前把过长输出裁到上限，防止单条工具结果炸掉上下文。 */
function normalizeOutput(result: ToolResult): ToolResult {
  if (result.output.length <= MAX_OUTPUT_CHARS) return result;
  const suffix = `\n…[truncated ${result.output.length - MAX_OUTPUT_CHARS} chars]`;
  const head = result.output.slice(0, Math.max(0, MAX_OUTPUT_CHARS - suffix.length));
  return {
    ok: result.ok,
    output: head + suffix,
    fallbackTokenLimitOverride: MAX_OUTPUT_CHARS,
    containsExternalContext: result.containsExternalContext,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function isTimeout(signal: AbortSignal): boolean {
  const reason = signal.reason;
  return reason instanceof Error && reason.name === "TimeoutError";
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
