/**
 * 工具运行时（对应 ToolCallRuntime）。
 *
 * 核心语义（详细设计 10.2）：
 * - 执行：派发即开始，可并行
 * - 回填：串行，严格按模型调用顺序（ordered 数组）
 * - 每个调用最终都有结果（失败/取消都落结构化的失败结果）
 */
import type { FunctionCallItem, ToolResult } from "@ao/protocol";
import type { EventSink } from "@ao/protocol";
import type { AgentHooks } from "../hooks.ts";
import type { StepContext } from "../step-context.ts";
import type { ToolOrchestrator } from "./orchestrator.ts";
import type { ResolvedToolCall, ToolRouter } from "./router.ts";

interface RunEntry {
  index: number;
  call: FunctionCallItem;
  toolName: string;
  startedAt: number;
  promise: Promise<ToolResult>;
}

export class ToolCallRuntime {
  private readonly ordered: RunEntry[] = [];
  private readonly dispatched = new Set<string>();

  constructor(
    private readonly step: StepContext,
    private readonly router: ToolRouter,
    private readonly orchestrator: ToolOrchestrator,
    private readonly emit: EventSink,
    private readonly hooks: AgentHooks | undefined,
  ) {}

  /**
   * 派发一个工具调用。重复 callId 被忽略（防重复执行）；
   * 返回的 promise 只用于内部收口，结果统一走 collect()。
   */
  dispatch(call: FunctionCallItem): void {
    if (this.dispatched.has(call.callId)) return;
    this.dispatched.add(call.callId);

    const resolved = this.router.resolve(call);
    const index = this.ordered.length;
    const startedAt = Date.now();

    this.emit({
      type: "tool_started",
      callId: call.callId,
      name: call.name,
      args: call.arguments,
    });

    const promise = this.runOne(resolved, startedAt);
    this.ordered.push({ index, call, toolName: call.name, startedAt, promise });
  }

  /**
   * 等待全部在途工具。结果按派发（= 模型调用）顺序返回，
   * 由回合循环负责按序写回历史（I4：执行并行、回填串行有序）。
   */
  async collect(): Promise<Array<{ call: FunctionCallItem; result: ToolResult }>> {
    const entries = [...this.ordered];
    const collected: Array<{ call: FunctionCallItem; result: ToolResult }> = [];
    for (const entry of entries) {
      const result = await entry.promise;
      const durationMs = Date.now() - entry.startedAt;
      this.emit({
        type: "tool_finished",
        callId: entry.call.callId,
        name: entry.toolName,
        ok: result.ok,
        output: result.output,
        durationMs,
      });
      this.hooks?.onToolEnd?.({
        call: entry.call,
        result,
        durationMs,
      });
      collected.push({ call: entry.call, result });
    }
    return collected;
  }

  /** 已派发的全部调用（收尾时判定「是否每个调用都有结果」用）。 */
  dispatchedCalls(): FunctionCallItem[] {
    return this.ordered.map((e) => e.call);
  }

  private async runOne(
    resolved: ResolvedToolCall,
    _startedAt: number,
  ): Promise<ToolResult> {
    if (resolved.failure) return resolved.failure;

    const parallel = this.router.supportsParallel(resolved.call.name);
    const release = parallel
      ? await this.step.gate.acquireRead()
      : await this.step.gate.acquireWrite();

    try {
      return await this.orchestrator.run(resolved.handler, resolved.args, {
        cwd: this.step.cwd,
        signal: this.step.signal,
      });
    } finally {
      release();
    }
  }
}
