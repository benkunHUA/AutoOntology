/**
 * 回合上下文：整轮冻结的身份与配置。
 * 构造后不可变；步骤级快照见 StepContext。
 */
export interface TurnContext {
  readonly turnId: string;
  readonly cwd: string;
  readonly model: string;
  readonly instructions: string;
  readonly startedAt: number;
}
