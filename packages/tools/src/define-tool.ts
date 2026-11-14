/**
 * 工具工厂：把 ToolRuntime 包装成模型侧 ToolHandler。
 *
 * Handler 的职责是「能不能调」，真正执行由编排器驱动 runtime.run。
 * 有副作用的工具必须经这里的 execute 主动调用 orchestrator。
 */
import type {
  Approvable,
  Sandboxable,
  ToolExecutionContext,
  ToolHandler,
  ToolResult,
  ToolRuntime,
  ToolSpec,
} from "@ao/protocol";

export interface ToolDefinition {
  spec: ToolSpec;
  sandboxable: Sandboxable;
  approvable: Approvable;
  run(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult>;
}

export function defineTool(definition: ToolDefinition): ToolHandler {
  const runtime: ToolRuntime = {
    sandboxable: definition.sandboxable,
    approvable: definition.approvable,
    run: definition.run,
  };

  return {
    spec: definition.spec,
    async execute(args, ctx) {
      return ctx.orchestrator.run(runtime, args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
        toolName: definition.spec.name,
        callId: ctx.callId,
      });
    },
  };
}
