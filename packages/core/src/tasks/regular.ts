/** 普通任务：用户请求驱动的标准五阶段回合。 */
import { runTurn } from "../engine/turn.ts";
import type { RunTurnDeps, TurnResult } from "../engine/turn.ts";
import type { SessionTask } from "./task.ts";

export class RegularTask implements SessionTask {
  readonly kind = "regular" as const;

  run(deps: RunTurnDeps): Promise<TurnResult> {
    return runTurn(deps);
  }
}
