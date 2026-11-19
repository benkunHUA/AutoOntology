export type AbortReason = "user" | "replaced" | "quota" | "error";

/** 回合被中断。取消的唯一「正常」异常类型。 */
export class AbortedError extends Error {
  readonly reason: AbortReason;
  constructor(reason: AbortReason, detail?: string) {
    super(detail ?? `turn aborted: ${reason}`);
    this.name = "AbortedError";
    this.reason = reason;
  }
}

/** 回合因错误终止（不可恢复）。 */
export class TurnError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TurnError";
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof AbortedError
      ? signal.reason
      : new AbortedError("error", String(signal.reason ?? "aborted"));
  }
}
