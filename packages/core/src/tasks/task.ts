/**
 * 任务接口：定义一种工作流程。
 *
 * 任务层不知道采样细节；它拿到装配好的依赖执行，返回回合结果。
 * 新增工作流（评审、压缩、子 agent）实现该接口即可。
 */
import type { RunTurnDeps, TurnResult } from "../turn.ts";

export interface SessionTask {
  readonly kind: "regular" | "review" | "compact";
  run(deps: RunTurnDeps): Promise<TurnResult>;
}
