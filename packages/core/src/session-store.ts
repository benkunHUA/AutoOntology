import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HistoryItem } from "@ao/protocol";
import { message } from "@ao/protocol";

export type ToolOutputRewriteReason =
  | "tool_result_persist"
  | "tool_result_placeholder"
  | "tool_result_preview";

export type StoredRecord =
  | {
      type: "session_meta";
      ordinal: number;
      timestamp: string;
      threadId: string;
      sessionId: string;
      cwd: string;
    }
  | {
      type: "history_item";
      ordinal: number;
      timestamp: string;
      item: HistoryItem;
    }
  | {
      type: "item_rewrite";
      ordinal: number;
      timestamp: string;
      callId: string;
      reason: ToolOutputRewriteReason;
      output: string;
      filePath?: string;
    }
  | {
      type: "range_archive";
      ordinal: number;
      timestamp: string;
      startOrdinal: number;
      endOrdinal: number;
      archivePath: string;
      markerText: string;
    }
  | {
      type: "compaction_checkpoint";
      ordinal: number;
      timestamp: string;
      window: number;
      windowId: string;
      previousWindowId?: string;
      summary: string;
      replacementHistory: HistoryItem[];
    };

export interface LoadedSession {
  history: HistoryItem[];
  window: number;
  windowId: string;
  previousWindowId?: string;
  lastOrdinal: number;
}

/** Canonical append-only session log with replay support. */
export class SessionStore {
  private chain: Promise<void> = Promise.resolve();
  private ready: Promise<void> | undefined;
  private closed = false;
  private ordinal = 0;

  constructor(readonly filePath: string) {}

  append(item: HistoryItem): void {
    this.write({
      type: "history_item",
      ordinal: this.ordinal++,
      timestamp: new Date().toISOString(),
      item,
    });
  }

  appendRewrite(
    callId: string,
    reason: ToolOutputRewriteReason,
    output: string,
    filePath?: string,
  ): void {
    this.write({
      type: "item_rewrite",
      ordinal: this.ordinal++,
      timestamp: new Date().toISOString(),
      callId,
      reason,
      output,
      filePath,
    });
  }

  appendArchive(
    startOrdinal: number,
    endOrdinal: number,
    archivePath: string,
    markerText: string,
  ): void {
    this.write({
      type: "range_archive",
      ordinal: this.ordinal++,
      timestamp: new Date().toISOString(),
      startOrdinal,
      endOrdinal,
      archivePath,
      markerText,
    });
  }

  appendCheckpoint(checkpoint: {
    window: number;
    windowId: string;
    previousWindowId?: string;
    summary: string;
    replacementHistory: HistoryItem[];
  }): void {
    this.write({
      type: "compaction_checkpoint",
      ordinal: this.ordinal++,
      timestamp: new Date().toISOString(),
      ...checkpoint,
    });
  }

  appendSessionMeta(meta: {
    threadId: string;
    sessionId: string;
    cwd: string;
  }): void {
    this.write({
      type: "session_meta",
      ordinal: this.ordinal++,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  close(): void {
    this.closed = true;
  }

  private write(record: StoredRecord): void {
    if (this.closed) return;
    this.chain = this.chain.then(async () => {
      await this.ensureDir();
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    });
    this.chain = this.chain.catch(() => {});
  }

  private ensureDir(): Promise<void> {
    this.ready ??= mkdir(dirname(this.filePath), { recursive: true }).then(
      () => {},
      (err) => {
        this.ready = undefined;
        throw err;
      },
    );
    return this.ready;
  }
}

export async function loadSession(filePath: string): Promise<LoadedSession> {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return {
      history: [],
      window: 0,
      windowId: "",
      lastOrdinal: -1,
    };
  }

  let history: HistoryItem[] = [];
  let ordinals = new Map<HistoryItem, number>();
  let window = 0;
  let windowId = "";
  let previousWindowId: string | undefined;
  let lastOrdinal = -1;

  const records = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StoredRecord);

  for (const record of records) {
    lastOrdinal = Math.max(lastOrdinal, record.ordinal);
    switch (record.type) {
      case "history_item":
        history.push(record.item);
        ordinals.set(record.item, record.ordinal);
        break;
      case "item_rewrite": {
        const index = history.findIndex(
          (item) =>
            item.type === "function_call_output" && item.callId === record.callId,
        );
        if (index >= 0 && history[index]?.type === "function_call_output") {
          const previous = history[index];
          const ordinal = ordinals.get(previous);
          const replacement = {
            ...history[index],
            output: record.output,
          } as HistoryItem;
          ordinals.delete(previous);
          ordinals.set(
            replacement,
            ordinal ?? record.ordinal,
          );
          history[index] = replacement;
        }
        break;
      }
      case "range_archive": {
        const next: HistoryItem[] = [];
        let inserted = false;
        for (const item of history) {
          const ordinal = ordinals.get(item);
          if (
            !inserted &&
            ordinal !== undefined &&
            ordinal >= record.startOrdinal
          ) {
            next.push(message("user", record.markerText));
            inserted = true;
          }
          if (
            ordinal === undefined ||
            ordinal < record.startOrdinal ||
            ordinal > record.endOrdinal
          ) {
            next.push(item);
          }
        }
        if (!inserted) next.push(message("user", record.markerText));
        history = next;
        ordinals = new Map(history.map((item, index) => [item, index]));
        break;
      }
      case "compaction_checkpoint": {
        history = record.replacementHistory.map((item) => ({ ...item }));
        ordinals = new Map(
          history.map((item, index) => [item, record.ordinal + index]),
        );
        window = record.window;
        windowId = record.windowId;
        previousWindowId = record.previousWindowId;
        break;
      }
      case "session_meta":
        break;
    }
  }

  return { history, window, windowId, previousWindowId, lastOrdinal };
}
