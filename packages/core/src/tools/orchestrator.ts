/**
 * 工具编排（对应 ToolOrchestrator）：审批 → 沙箱 → 执行 → 失败重试。
 *
 * 骨架阶段：无审批、无沙箱，直接执行；执行异常归一化为失败结果
 * （可回答的失败写回历史，对应错误处理矩阵「工具失败（可回答）」）。
 * M3 在这里插入审批 UI 钩子与沙箱选择。
 */
import type { ToolContext, ToolHandler, ToolResult } from "@ao/protocol";

export class ToolOrchestrator {
  async run(
    handler: ToolHandler,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    try {
      const result = await handler.execute(args, ctx);
      return normalizeOutput(result);
    } catch (error) {
      return {
        ok: false,
        output: `tool ${handler.spec.name} failed: ${(error as Error).message}`,
      };
    }
  }
}

/** 输出截断：写回历史前把过长输出裁到上限，防止单条工具结果炸掉上下文。 */
const MAX_OUTPUT_CHARS = 16_000;

function normalizeOutput(result: ToolResult): ToolResult {
  if (result.output.length <= MAX_OUTPUT_CHARS) return result;
  return {
    ok: result.ok,
    output:
      result.output.slice(0, MAX_OUTPUT_CHARS) +
      `\n…[truncated ${result.output.length - MAX_OUTPUT_CHARS} chars]`,
  };
}
