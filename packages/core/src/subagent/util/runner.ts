/**
 * subagent 工具的统一执行壳。
 *
 * 每个 handler 都从 ToolContext 解出 AgentControl 与当前 agent 身份，
 * 然后执行纯业务调用。这里统一处理「未注入控制面」和业务错误，
 * 保证六个工具的失败形态一致。
 */
import type {
  AgentControl,
  ToolContext,
  ToolResult,
} from "@ao/protocol";

export type AgentToolCall = (
  control: AgentControl,
  caller: NonNullable<ToolContext["agentCaller"]>,
) => Promise<unknown>;

export function jsonOutput(value: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(value) };
}

export async function runAgentTool(
  ctx: ToolContext,
  call: AgentToolCall,
): Promise<ToolResult> {
  if (!ctx.agentControl || !ctx.agentCaller) {
    return {
      ok: false,
      output: "subagent 工具不可用：未配置 agent control",
    };
  }

  try {
    return jsonOutput(await call(ctx.agentControl, ctx.agentCaller));
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return {
      ok: false,
      output: `subagent 工具执行失败：${(error as Error).message}`,
    };
  }
}

