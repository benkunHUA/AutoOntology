/**
 * 工具层契约。
 *
 * 工具实现（@ao/tools）与工具调度（@ao/core）都依赖这里的接口，
 * 避免 core ↔ tools 循环依赖。
 */

/** 下发给模型的工具声明。 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema。 */
  parameters: Record<string, unknown>;
  /**
   * 是否声明可并行（对应设计中的「读锁」）。
   * 未声明 = 独占写锁，执行期间其他工具排队。
   */
  supportsParallel?: boolean;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** 写回历史的输出文本（会被截断到合理长度）。 */
  output: string;
}

/**
 * 工具执行器接口（对应 ToolRuntime）。
 * execute 必须尊重 signal：收到取消后尽快收手并返回已有结果。
 */
export interface ToolHandler {
  readonly spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
