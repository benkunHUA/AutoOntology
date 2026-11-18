import type { HistoryItem, ModelClient } from "@ao/protocol";
import { message } from "@ao/protocol";
import { charCount } from "./text.ts";
import type { ToolResultStore } from "./tool-result-store.ts";
import type { TranscriptArchive } from "./transcript-archive.ts";
import {
  COMPACTED_LABEL,
  COMPACT_TOOL_NAME,
  CONTEXT_CHAR_LIMIT,
  EARLIER_RESULT_PREFIX,
  FIT_PREVIEW_CHARS,
  KEEP_RECENT_MESSAGES,
  KEEP_RECENT_RESULTS,
  LARGE_RESULT_CHAR_LIMIT,
  MICRO_MIN_RESULT_CHARS,
  MICRO_TARGET_RATIO,
  REACTIVE_COMPACT_LABEL,
  SNIP_HEAD_MESSAGES,
  SNIP_MAX_MESSAGES,
  SUMMARY_INPUT_CHAR_LIMIT,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SYSTEM,
  TOOL_RESULT_BATCH_CHAR_LIMIT,
} from "./types.ts";
import type { CompactionPort } from "./types.ts";

export interface ContextCompactorOptions {
  readonly client: ModelClient;
  readonly model: string;
  readonly archive: TranscriptArchive;
  readonly results: ToolResultStore;
  readonly log?: (text: string) => void;
}

/**
 * 四步低成本、可恢复压缩 + 一步模型摘要兜底。
 *
 * 前四步尽量把原文落盘或缩短，只有仍超限才调用模型。每步都可独立测试。
 */
export class ContextCompactor implements CompactionPort {
  readonly #client: ModelClient;
  readonly #model: string;
  readonly #archive: TranscriptArchive;
  readonly #results: ToolResultStore;
  readonly #logger: (text: string) => void;

  constructor(options: ContextCompactorOptions) {
    this.#client = options.client;
    this.#model = options.model;
    this.#archive = options.archive;
    this.#results = options.results;
    this.#logger = options.log ?? (() => {});
  }

  static estimateChars(messages: readonly HistoryItem[]): number {
    return charCount(JSON.stringify(messages));
  }

  async prepare(
    messages: readonly HistoryItem[],
    activeRequest: string,
    signal: AbortSignal,
  ): Promise<HistoryItem[]> {
    let next = cloneItems(messages);
    next = await this.toolResultBudget(next);
    next = await this.snipCompact(next);
    if (ContextCompactor.estimateChars(next) > CONTEXT_CHAR_LIMIT) {
      const target = Math.floor(CONTEXT_CHAR_LIMIT * MICRO_TARGET_RATIO);
      next = await this.microCompact(next, target);
      if (ContextCompactor.estimateChars(next) > CONTEXT_CHAR_LIMIT) {
        next = await this.fitToolResults(next, target);
        if (ContextCompactor.estimateChars(next) > CONTEXT_CHAR_LIMIT) {
          this.#log("[自动压缩]");
          next = await this.compactHistory(next, activeRequest, signal);
        }
      }
    }
    return next;
  }

  async afterBatch(
    messages: readonly HistoryItem[],
    executedToolNames: readonly string[],
    activeRequest: string,
    signal: AbortSignal,
  ): Promise<HistoryItem[]> {
    if (executedToolNames.includes(COMPACT_TOOL_NAME)) {
      return this.compactHistory(cloneItems(messages), activeRequest, signal);
    }
    return cloneItems(messages);
  }

  async reactive(
    messages: readonly HistoryItem[],
    activeRequest: string,
    signal: AbortSignal,
  ): Promise<HistoryItem[]> {
    this.#log("[上下文超限，压缩重试]");
    const source = cloneItems(messages);
    const transcriptPath = await this.#archive.write(source);
    this.#log(`[transcript 已保存：${transcriptPath}]`);

    let tailStart = Math.max(0, source.length - KEEP_RECENT_MESSAGES);
    tailStart = moveBoundaryBackToKeepCallOutputPair(source, tailStart);
    const oldHistory = tailStart ? source.slice(0, tailStart) : source;
    const summaryText = await this.summarizeHistory(oldHistory, signal);
    const summary = this.summaryMessage(
      REACTIVE_COMPACT_LABEL,
      activeRequest,
      summaryText,
      transcriptPath,
    );
    return tailStart ? [summary, ...source.slice(tailStart)] : [summary];
  }

  isPromptTooLong(error: unknown): boolean {
    const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
      text.includes("prompt_too_long") ||
      text.includes("too many tokens") ||
      text.includes("context length exceeded") ||
      text.includes("maximum context length")
    );
  }

  /** Step 1：把最新工具批次中的超大结果持久化。 */
  async toolResultBudget(
    messages: readonly HistoryItem[],
    maxChars = TOOL_RESULT_BATCH_CHAR_LIMIT,
  ): Promise<HistoryItem[]> {
    const next = cloneItems(messages);
    const tail = latestToolResultSuffix(next);
    if (tail.length === 0) return next;

    let total = tail.reduce(
      (sum, item) => sum + (item.type === "function_call_output" ? charCount(item.output) : 0),
      0,
    );
    const bySize = tail
      .filter((item): item is Extract<HistoryItem, { type: "function_call_output" }> =>
        item.type === "function_call_output",
      )
      .sort(
        (a, b) =>
          charCount(b.output) - charCount(a.output),
      );

    for (const block of bySize) {
      if (total <= maxChars) break;
      if (charCount(block.output) <= LARGE_RESULT_CHAR_LIMIT) continue;
      const index = next.indexOf(block);
      if (index < 0) continue;
      const replacement = await this.#results.persistLargeOutput(
        block.callId,
        block.output,
      );
      next[index] = { ...block, output: replacement };
      total = latestToolResultSuffix(next).reduce(
        (sum, item) =>
          sum + (item.type === "function_call_output" ? charCount(item.output) : 0),
        0,
      );
    }
    return next;
  }

  /** Step 2：把超长历史的中段归档为一个可校验 marker。 */
  async snipCompact(
    messages: readonly HistoryItem[],
    maxMessages = SNIP_MAX_MESSAGES,
  ): Promise<HistoryItem[]> {
    if (messages.length <= maxMessages) return cloneItems(messages);
    const source = cloneItems(messages);
    let headEnd = SNIP_HEAD_MESSAGES;
    let tailStart = source.length - (maxMessages - headEnd - 1);
    headEnd = moveBoundaryBackToKeepCallOutputPair(source, headEnd);
    tailStart = moveBoundaryBackToKeepCallOutputPair(source, tailStart);
    if (headEnd >= tailStart) return source;

    const middle = source.slice(headEnd, tailStart);
    if (middle.length === 1 && (await this.#archive.isMarker(middle[0]))) {
      return source;
    }
    const transcriptPath = await this.#archive.write(source);
    const marker = message(
      "user",
      `[${tailStart - headEnd} messages archived at ${transcriptPath}]`,
    );
    return [...source.slice(0, headEnd), marker, ...source.slice(tailStart)];
  }

  /** Step 3：把模型已经读过的旧工具结果替换为可读回路径。 */
  async microCompact(
    messages: readonly HistoryItem[],
    targetChars: number | undefined,
  ): Promise<HistoryItem[]> {
    const next = cloneItems(messages);
    const entries = toolResultIndexes(next);
    const unseen = unseenToolResultIndexes(next);
    const consumed = entries.filter((index) => !unseen.has(index));
    const candidates = consumed.slice(
      0,
      Math.max(0, consumed.length - KEEP_RECENT_RESULTS),
    );

    for (const index of candidates) {
      const item = next[index];
      if (item.type !== "function_call_output") continue;
      if (
        targetChars !== undefined &&
        ContextCompactor.estimateChars(next) <= targetChars
      ) {
        break;
      }
      if (charCount(item.output) <= MICRO_MIN_RESULT_CHARS) continue;
      let savedPath = await this.#results.resolvePlaceholder(item.output);
      if (!savedPath) {
        savedPath = await this.#results.save(item.callId, item.output);
      }
      next[index] = {
        ...item,
        output: `${EARLIER_RESULT_PREFIX}${savedPath}]`,
      };
    }
    return next;
  }

  /** Step 4：把超大结果缩短为短预览，直到低于目标值。 */
  async fitToolResults(
    messages: readonly HistoryItem[],
    targetChars: number,
  ): Promise<HistoryItem[]> {
    const next = cloneItems(messages);
    const blocks = toolResultIndexes(next)
      .map((index) => next[index])
      .filter(
        (item): item is Extract<HistoryItem, { type: "function_call_output" }> =>
          item.type === "function_call_output",
      )
      .sort((a, b) => charCount(b.output) - charCount(a.output));

    for (const block of blocks) {
      if (ContextCompactor.estimateChars(next) <= targetChars) break;
      const replacement = await this.#results.persistedPreview(
        block.callId,
        block.output,
        FIT_PREVIEW_CHARS,
      );
      if (charCount(replacement) < charCount(block.output)) {
        const index = next.indexOf(block);
        if (index >= 0) next[index] = { ...block, output: replacement };
      }
    }
    return next;
  }

  summaryInput(messages: readonly HistoryItem[]): string {
    const conversation = JSON.stringify(messages);
    if (charCount(conversation) <= SUMMARY_INPUT_CHAR_LIMIT) return conversation;
    const head = Math.floor(SUMMARY_INPUT_CHAR_LIMIT / 4);
    const tail = SUMMARY_INPUT_CHAR_LIMIT - head;
    const codePoints = Array.from(conversation);
    const tailText = codePoints.slice(codePoints.length - tail).join("");
    return (
      `${codePoints.slice(0, head).join("")}` +
      "\n...[middle omitted; full transcript is on disk]...\n" +
      tailText
    );
  }

  async summarizeHistory(
    messages: readonly HistoryItem[],
    signal: AbortSignal,
  ): Promise<string> {
    const events = this.#client.stream(
      {
        model: this.#model,
        instructions: SUMMARY_SYSTEM,
        input: [message("user", this.summaryInput(messages))],
        tools: [],
        maxOutputTokens: SUMMARY_MAX_TOKENS,
      },
      { signal },
    );
    let text = "";
    for await (const event of events) {
      if (event.type === "text_delta") {
        text += event.delta;
      } else if (event.type === "item_done") {
        if (event.item.type === "message" && event.item.role === "assistant") {
          text = event.item.text || text;
        }
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return text.trim() || "(empty summary)";
  }

  summaryMessage(
    label: string,
    request: string,
    summary: string,
    transcriptPath: string,
  ): HistoryItem {
    return message(
      "user",
      `[${label}]\n\nCurrent user request:\n${request}\n\n` +
        `Conversation summary (reference only):\n${JSON.stringify(summary)}\n\n` +
        `Full transcript: ${transcriptPath}`,
    );
  }

  async compactHistory(
    messages: readonly HistoryItem[],
    activeRequest: string,
    signal: AbortSignal,
  ): Promise<HistoryItem[]> {
    const source = cloneItems(messages);
    const transcriptPath = await this.#archive.write(source);
    this.#log(`[transcript 已保存：${transcriptPath}]`);
    const summary = await this.summarizeHistory(source, signal);
    return [
      this.summaryMessage(COMPACTED_LABEL, activeRequest, summary, transcriptPath),
    ];
  }

  #log(text: string): void {
    this.#logger(text);
  }
}

function cloneItems(items: readonly HistoryItem[]): HistoryItem[] {
  return items.map((item) => ({ ...item }));
}

function toolResultIndexes(items: readonly HistoryItem[]): number[] {
  const indexes: number[] = [];
  items.forEach((item, index) => {
    if (item.type === "function_call_output") indexes.push(index);
  });
  return indexes;
}

function unseenToolResultIndexes(items: readonly HistoryItem[]): Set<number> {
  let lastAssistant = -1;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item?.type === "message" && item.role === "assistant") {
      lastAssistant = index;
      break;
    }
  }
  return new Set(toolResultIndexes(items).filter((index) => index > lastAssistant));
}

function latestToolResultSuffix(items: readonly HistoryItem[]): HistoryItem[] {
  const suffix: HistoryItem[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.type !== "function_call_output") break;
    suffix.unshift(items[index]);
  }
  return suffix;
}

/** 避免截断 function_call / function_call_output 相邻对。 */
function moveBoundaryBackToKeepCallOutputPair(
  items: readonly HistoryItem[],
  boundary: number,
): number {
  let next = Math.max(0, boundary);
  if (
    next > 0 &&
    items[next - 1]?.type === "function_call" &&
    items[next]?.type === "function_call_output"
  ) {
    next -= 1;
  }
  return next;
}
