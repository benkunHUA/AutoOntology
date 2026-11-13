/**
 * 会话持久化：追加式 JSONL（一行一个历史条目）。
 *
 * 不变量 I7：发终止事件前历史已落盘 → 上层在发事件前 await flush()。
 * 写入串行化：所有 append 进入同一条 promise 链，保证行序即历史序。
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { HistoryItem } from "@ao/protocol";

export class JsonlPersistence {
  private chain: Promise<void> = Promise.resolve();
  private ready: Promise<void> | undefined;
  private closed = false;

  constructor(readonly filePath: string) {}

  /** 目录只创建一次；失败时清空缓存，下次 append 重试。 */
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

  append(item: HistoryItem): void {
    if (this.closed) return;
    this.chain = this.chain.then(async () => {
      await this.ensureDir();
      await appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    });
    // 吞掉单次写失败，flush() 时会重新暴露
    this.chain = this.chain.catch(() => {});
  }

  /** 等待所有在途写入落地。 */
  async flush(): Promise<void> {
    await this.chain;
  }

  close(): void {
    this.closed = true;
  }
}
