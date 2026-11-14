/**
 * 采样重试。
 *
 * 关键语义：重试必须「重建请求」——由调用方传工厂函数而不是现成请求，
 * 因为重试时历史可能已经变化（在途工具结果需要先回填）。
 *
 * 半截文本的规避：重试只发生在「本步骤尚未向客户端输出可见文本」前
 * （由调用方的 onAttemptStart 钩子保证）。一旦开始流式输出，本步骤不再
 * 整体重试，改为终止或让上层决定。
 */
import type { ModelClient, ModelRequest, ResponseEvent } from "@ao/protocol";
import { TransportError } from "./responses.ts";

export interface RetryPolicy {
  /** 总尝试次数（含首次）。 */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

export interface RetryHooks {
  /** 每次尝试开始（含首次）。可在此判断「是否已产生可见输出」。 */
  onAttemptStart?(attempt: number): void;
  /** 失败且将要重试。 */
  onRetry?(attempt: number, error: unknown, delayMs: number): void;
}

/**
 * 对 model.stream 做有限次重试。yield 出去的事件直接透传；
 * 只有「未开始产出事件即失败」才重试，避免重复展示半句话。
 */
export async function* streamWithRetry(
  client: ModelClient,
  request: () => ModelRequest,
  signal: AbortSignal,
  policy: RetryPolicy = defaultRetryPolicy,
  hooks: RetryHooks = {},
): AsyncGenerator<ResponseEvent, void, void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    hooks.onAttemptStart?.(attempt);
    let emitted = false;

    try {
      for await (const event of client.stream(request(), { signal })) {
        emitted = true;
        yield event;
      }
      return;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      const retryable =
        error instanceof TransportError ? error.retryable : isAbortLike(error);
      if (!retryable || emitted || attempt === policy.maxAttempts) {
        throw error;
      }
      lastError = error;
      const delay = backoffDelay(attempt, policy);
      hooks.onRetry?.(attempt, error, delay);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

function backoffDelay(attempt: number, policy: RetryPolicy): number {
  const exp = policy.baseDelayMs * 2 ** (attempt - 1);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exp * jitter, policy.maxDelayMs);
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /fetch failed|ECONNRESET|socket hang up/i.test(error.message))
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
