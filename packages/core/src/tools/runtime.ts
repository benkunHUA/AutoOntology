/**
 * 工具运行时。
 *
 * 核心语义：
 * - 执行：派发即开始，可并行
 * - 回填：串行，严格按模型调用顺序（ordered 数组）
 * - 每个调用最终都有结果（失败/取消都落结构化的失败结果）
 */
import { ToolError } from "@ao/protocol";
import type { FunctionCallItem, ToolResult } from "@ao/protocol";
import type { EventSink } from "@ao/protocol";
import type { AgentHooks } from "../hooks.ts";
import type { StepContext } from "../step-context.ts";
import { isTimeout, type ToolOrchestrator } from "./orchestrator.ts";
import type { ResolvedToolCall, ToolRouter } from "./router.ts";

interface ToolRunOutcome {
  result: ToolResult;
  aborted: boolean;
  timeoutMs?: number;
}

interface RunEntry {
  index: number;
  call: FunctionCallItem;
  toolName: string;
  startedAt: number;
  tags: Record<string, string>;
  promise: Promise<ToolRunOutcome>;
}

export class ToolCallRuntime {
  private readonly ordered: RunEntry[] = [];

  constructor(
    private readonly step: StepContext,
    private readonly router: ToolRouter,
    private readonly orchestrator: ToolOrchestrator,
    private readonly emit: EventSink,
    private readonly hooks: AgentHooks | undefined,
  ) {}

  /**
   * 派发一个工具调用。默认路径不启用进程内占坑，
   * at-least-once，重复投递会再次执行，不保证去重。
   */
  dispatch(call: FunctionCallItem): void {
    const startedAt = Date.now();
    const resolved = this.router.resolve(call);
    if (resolved.failure) {
      this.ordered.push({
        index: this.ordered.length,
        call,
        toolName: call.name,
        startedAt,
        tags: {},
        promise: Promise.resolve({ result: resolved.failure, aborted: false }),
      });
      return;
    }

    const handler = resolved.handler!;
    const tags = handler.telemetryTags?.(resolved.args) ?? {};
    const timeoutMs = this.orchestrator.effectiveTimeoutMs(handler.spec.timeoutMs);
    const deadlineSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([this.step.signal, deadlineSignal]);

    this.ordered.push({
      index: this.ordered.length,
      call,
      toolName: call.name,
      startedAt,
      tags,
      promise: this.runOne(resolved, signal, timeoutMs),
    });
  }

  /**
   * 等待全部在途工具。结果按派发（= 模型调用）顺序返回，
   * 由回合循环负责按序写回历史：执行并行、回填串行有序。
   */
  async collect(): Promise<Array<{ call: FunctionCallItem; result: ToolResult }>> {
    const entries = [...this.ordered];
    const collected: Array<{ call: FunctionCallItem; result: ToolResult }> = [];
    for (const entry of entries) {
      const outcome = await entry.promise;
      const durationMs = Date.now() - entry.startedAt;
      const tags =
        outcome.timeoutMs === undefined
          ? entry.tags
          : { ...entry.tags, timeout_ms: String(outcome.timeoutMs) };
      if (outcome.aborted) {
        this.emit({
          type: "tool_aborted",
          callId: entry.call.callId,
          name: entry.toolName,
          durationMs,
          output: outcome.result.output,
        });
      } else {
        this.emit({
          type: "tool_finished",
          callId: entry.call.callId,
          name: entry.toolName,
          ok: outcome.result.ok,
          output: outcome.result.output,
          durationMs,
          tags,
        });
      }
      this.hooks?.onToolEnd?.({
        call: entry.call,
        result: outcome.result,
        durationMs,
        tags,
      });
      collected.push({ call: entry.call, result: outcome.result });
    }
    return collected;
  }

  private async runOne(
    resolved: ResolvedToolCall,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<ToolRunOutcome> {
    const handler = resolved.handler;
    if (!handler) {
      return {
        result: { ok: false, output: `unknown tool: ${resolved.call.name}` },
        aborted: false,
      };
    }

    if (handler.matchesKind?.(resolved.args) === false) {
      throw new ToolError("fatal", "tool payload kind mismatch");
    }

    const parallel = this.router.supportsParallel(resolved.call.name);
    let release: (() => void) | undefined;
    try {
      release = parallel
        ? await this.step.gate.acquireRead(signal)
        : await this.step.gate.acquireWrite(signal);
    } catch (error) {
      return {
        result: abortResult(signal, resolved.call.name, error),
        aborted: signal.aborted && !isTimeout(signal),
        timeoutMs: isTimeout(signal) ? timeoutMs : undefined,
      };
    }

    // 拿锁后才发 start，排队中的调用不会被误报为 started。
    this.emit({
      type: "tool_started",
      callId: resolved.call.callId,
      name: resolved.call.name,
      args: resolved.call.arguments,
    });

    try {
      try {
        const result = await handler.execute(resolved.args, {
          cwd: this.step.cwd,
          signal,
          toolName: resolved.call.name,
          callId: resolved.call.callId,
          orchestrator: this.orchestrator,
        });
        return { result, aborted: false };
      } catch (error) {
        if (error instanceof ToolError && error.kind === "fatal") {
          throw error;
        }
        if (signal.aborted) {
          return {
            result: abortResult(signal, resolved.call.name, error),
            aborted: !isTimeout(signal),
            timeoutMs: isTimeout(signal) ? timeoutMs : undefined,
          };
        }
        if (error instanceof ToolError) {
          return {
            result: { ok: false, output: error.message },
            aborted: false,
          };
        }
        return {
          result: {
            ok: false,
            output: `tool ${resolved.call.name} failed: ${(error as Error).message}`,
          },
          aborted: false,
        };
      }
    } finally {
      release();
    }
  }
}

function abortResult(
  signal: AbortSignal,
  toolName: string,
  error: unknown,
): ToolResult {
  if (isTimeout(signal)) {
    return { ok: false, output: `tool ${toolName} timed out` };
  }
  const reason =
    error instanceof Error && error.message ? error.message : String(error);
  return { ok: false, output: `tool aborted: ${reason}` };
}
