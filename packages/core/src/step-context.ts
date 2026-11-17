/**
 * 步骤快照：一次采样请求的权限与环境快照。
 * 工具执行时读取的永远是「捕获时」的版本，回合中途变更配置不影响在途调用。
 */
import type { ToolRouter } from "./tools/router.ts";
import type { ReadWriteGate } from "./tools/gate.ts";
import type { TurnContext } from "./turn-context.ts";

export interface StepContext {
  readonly turn: TurnContext;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly router: ToolRouter;
  readonly gate: ReadWriteGate;
  /** 步骤序号（自 1 起），观测用。 */
  readonly stepIndex: number;
}

export function captureStepContext(input: {
  turn: TurnContext;
  cwd: string;
  signal: AbortSignal;
  router: ToolRouter;
  gate: ReadWriteGate;
  stepIndex: number;
}): StepContext {
  return Object.freeze({ ...input });
}
