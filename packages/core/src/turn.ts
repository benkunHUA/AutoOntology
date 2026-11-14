/**
 * 回合执行。
 *
 * 三层循环简化版：
 *   步骤循环（外层 for）→ 重试循环（streamWithRetry）→ 事件循环（内层 for）
 *
 * 是否继续只由三个输入决定：
 *   1. 本步有工具调用           → 继续
 *   2. 服务端声明 needsContinue → 继续
 *   3. 有尚未消费的待处理输入    → 继续
 * 三条件皆不成立时询问停止钩子，钩子也不要求继续则收工。
 */
import {
  AbortedError,
  TurnError,
  throwIfAborted,
} from "./errors.ts";
import type { AgentHooks, TurnSummary } from "./hooks.ts";
import type { ContextManager } from "./context-manager.ts";
import type { InputQueue } from "./input-queue.ts";
import type { TurnContext } from "./turn-context.ts";
import { captureStepContext } from "./step-context.ts";
import { ReadWriteGate } from "./tools/gate.ts";
import type { ToolRouter } from "./tools/router.ts";
import { ToolOrchestrator } from "./tools/orchestrator.ts";
import { createSandboxManager } from "./tools/sandbox.ts";
import { ToolCallRuntime } from "./tools/runtime.ts";
import { shouldCompact } from "./compaction.ts";
import { streamWithRetry } from "@ao/api";
import type {
  ApprovalGate,
  EventSink,
  FunctionCallItem,
  HistoryItem,
  ModelClient,
  SandboxManager,
  Usage,
} from "@ao/protocol";
import { functionCallOutput, message } from "@ao/protocol";

export interface RunTurnDeps {
  turn: TurnContext;
  history: ContextManager;
  inputQueue: InputQueue;
  client: ModelClient;
  router: ToolRouter;
  emit: EventSink;
  hooks?: AgentHooks;
  signal: AbortSignal;
  approval?: ApprovalGate;
  sandbox?: SandboxManager;
}

export interface TurnResult {
  finalMessage: string | null;
  usage: Usage;
}

export async function runTurn(deps: RunTurnDeps): Promise<TurnResult> {
  const { turn, history, inputQueue, client, router, emit, hooks, signal } = deps;
  const orchestrator = new ToolOrchestrator({
    approval: deps.approval,
    sandbox: deps.sandbox ?? createSandboxManager(),
  });
  const gate = new ReadWriteGate();

  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let toolCalls = 0;
  let finalMessage: string | null = null;
  let stepIndex = 0;

  for (;;) {
    throwIfAborted(signal);
    stepIndex++;

    // ── 步骤边界：消费待处理输入（插话） ───────────────────────────
    for (const pending of inputQueue.drain()) {
      const reviewed = hooks?.reviewInput
        ? await hooks.reviewInput(pending, turn)
        : pending.text;
      if (reviewed === null) continue; // 被钩子拦截
      history.append(message("user", reviewed));
    }

    // ── 开火前压缩体检：压缩先于新输入落账，目前只做判定告警 ──
    if (shouldCompact(history)) {
      console.warn(
        `[core] context ~${history.estimateTokens()} tokens, compaction pending`,
      );
    }

    // ── 步骤快照：本步的工具表、环境、取消信号 ─────────────────────
    const step = captureStepContext({
      cwd: turn.cwd,
      signal,
      router,
      gate,
      stepIndex,
    });
    const runtime = new ToolCallRuntime(step, router, orchestrator, emit, hooks);
    const stepToolCalls: FunctionCallItem[] = [];

    // ── 采样：重试循环包住事件循环 ────────────────────────────────
    let needsContinue = false;
    let stepText = "";

    const events = streamWithRetry(
      client,
      () => ({
        model: turn.model,
        instructions: turn.instructions,
        input: history.serialize(),
        tools: router.modelVisibleSpecs(),
      }),
      signal,
      undefined,
      { onAttemptStart: () => {} },
    );

    for await (const event of events) {
      throwIfAborted(signal);
      switch (event.type) {
        case "item_started":
          emit({ type: "item_started", index: event.index });
          break;

        case "text_delta":
          stepText += event.delta;
          emit({ type: "text_delta", delta: event.delta });
          break;

        case "reasoning_delta":
          emit({ type: "reasoning_delta", delta: event.delta });
          break;

        case "item_done": {
          const item: HistoryItem = event.item;
          history.append(item);
          if (item.type === "function_call") {
            // 先记账（append 已完成）→ 立即派发（并行门）
            stepToolCalls.push(item);
            toolCalls++;
            runtime.dispatch(item);
          } else if (item.type === "message" && item.role === "assistant") {
            finalMessage = item.text;
          }
          break;
        }

        case "response_completed":
          needsContinue = event.needsContinue;
          if (event.usage) {
            usage = {
              inputTokens: usage.inputTokens + event.usage.inputTokens,
              outputTokens: usage.outputTokens + event.usage.outputTokens,
            };
          }
          break;

        case "error":
          throw new TurnError(event.message);
      }
    }

    // ── 流结束：等在途工具，按调用顺序串行回填 ────────────────
    const collected = await runtime.collect();
    for (const { call, result } of collected) {
      history.append(functionCallOutput(call.callId, result.output, result.ok));
    }

    // ── 是否继续：只有三个输入，不做文本语义判断 ────────────────────
    const shouldContinue =
      stepToolCalls.length > 0 || needsContinue || inputQueue.hasPending();

    if (!shouldContinue) {
      const summary: TurnSummary = {
        turnId: turn.turnId,
        finalMessage,
        durationMs: Date.now() - turn.startedAt,
        toolCalls,
        estimateTokens: history.estimateTokens(),
      };
      if (hooks?.beforeFinish?.(summary) === false) {
        // 停止钩子要求继续（例如等待后台压缩完成）：再走一步
        continue;
      }
      break;
    }
  }

  return { finalMessage, usage };
}
