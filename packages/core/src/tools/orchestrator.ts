/**
 * 工具编排：审批 → 沙箱 → 执行 → 失败重试。
 *
 * 编排器由 Handler 在 execute 内主动调用，而不是分发层统一包装。
 * 已落地审批、沙箱 fail-closed、deadline、错误隔离与截断上报。
 */
import { ToolError } from "@ao/protocol";
import type {
  ApprovalGate,
  SandboxManager,
  ToolExecutionContext,
  ToolOrchestrator as ToolOrchestratorContract,
  ToolResult,
  ToolRuntime,
} from "@ao/protocol";
import { SandboxDeniedError } from "./sandbox.ts";

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 16_000;

export interface ToolOrchestratorOptions {
  defaultTimeoutMs?: number;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
}

export class ToolOrchestrator implements ToolOrchestratorContract {
  private readonly configuredDefaultTimeoutMs: number;
  private readonly approval: ApprovalGate | undefined;
  private readonly sandbox: SandboxManager | undefined;

  constructor(options: ToolOrchestratorOptions = {}) {
    const { defaultTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS } = options;
    this.configuredDefaultTimeoutMs =
      defaultTimeoutMs > 0 ? defaultTimeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
    this.approval = options.approval;
    this.sandbox = options.sandbox;
  }

  get defaultTimeoutMs(): number {
    return this.configuredDefaultTimeoutMs;
  }

  /** 工具未声明 deadline 或声明 <= 0 时，一律回退到宿主默认值。 */
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
      const approved = this.approval
        ? await this.approval.request({
            toolName: ctx.toolName,
            callId: ctx.callId,
            action,
            requiresHuman: requirement === "needs_human_approval",
          })
        : false;
      if (!approved) {
        return {
          ok: false,
          output: `tool ${ctx.toolName} was not approved`,
        };
      }
    }

    const sandboxPreference =
      runtime.sandboxable?.sandboxPreference() ?? "unsandboxed";
    if (sandboxPreference === "sandboxed" && !this.sandbox?.available) {
      return {
        ok: false,
        output: `sandbox unavailable for ${ctx.toolName}`,
      };
    }
    const runtimeCtx =
      sandboxPreference === "sandboxed" ? { ...ctx, sandbox: this.sandbox } : ctx;

    try {
      const result = await runtime.run(args, runtimeCtx);
      return normalizeOutput(result);
    } catch (error) {
      if (
        error instanceof SandboxDeniedError &&
        runtime.sandboxable?.escalateOnFailure() !== false
      ) {
        const escalated = this.approval
          ? await this.approval.request({
              toolName: ctx.toolName,
              callId: ctx.callId,
              action: `${action} (retry unsandboxed)`,
              requiresHuman: true,
              escalated: true,
            })
          : false;
        if (escalated) {
          return await runtime.run(args, {
            ...ctx,
            sandboxOverride: "unsandboxed",
          });
        }
        return {
          ok: false,
          output: `tool ${ctx.toolName} sandbox denied: ${error.message}`,
        };
      }
      if (error instanceof ToolError && error.kind === "fatal") {
        throw error;
      }
      if (ctx.signal.aborted || isAbortError(error)) {
        if (isTimeout(ctx.signal) || isTimeoutError(error)) {
          return {
            ok: false,
            output: `tool ${ctx.toolName} timed out`,
          };
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
}

/** 输出截断：写回历史前把过长输出裁到上限，防止单条工具结果炸掉上下文。 */
function normalizeOutput(result: ToolResult): ToolResult {
  if (result.output.length <= MAX_OUTPUT_CHARS) return result;
  const suffix = `\n…[truncated ${result.output.length - MAX_OUTPUT_CHARS} chars]`;
  const head = result.output.slice(0, Math.max(0, MAX_OUTPUT_CHARS - suffix.length));
  return {
    ok: result.ok,
    output: head + suffix,
    // 历史层沿用同一上限，避免二次截断后口径漂移。
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
