/**
 * 工具并发门（对应设计 10.1「并发模型」）。
 *
 * 语义：可并行工具持读锁，独占工具持写锁。写者优先——
 * 有写者在等待时不再放新读者进入，避免独占工具被读请求饿死。
 */
type Waiter = {
  resolve: (release: () => void) => void;
};

export class ReadWriteGate {
  private readers = 0;
  private writing = false;
  private waitingWriters: Waiter[] = [];
  private waitingReaders: Waiter[] = [];

  async acquireRead(): Promise<() => void> {
    if (this.writing || this.waitingWriters.length > 0) {
      await new Promise<void>((resolve) =>
        this.waitingReaders.push({
          resolve: () => {
            this.readers++;
            resolve();
          },
        }),
      );
    } else {
      this.readers++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.readers--;
      if (this.readers === 0) this.wakeNext();
    };
  }

  async acquireWrite(): Promise<() => void> {
    if (this.writing || this.readers > 0) {
      await new Promise<void>((resolve) =>
        this.waitingWriters.push({
          resolve: () => {
            this.writing = true;
            resolve();
          },
        }),
      );
    } else {
      this.writing = true;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.writing = false;
      this.wakeNext();
    };
  }

  private wakeNext(): void {
    if (this.writing) return;
    if (this.waitingWriters.length > 0) {
      this.waitingWriters.shift()!.resolve(() => {});
      return;
    }
    if (this.readers === 0) {
      const readers = this.waitingReaders;
      this.waitingReaders = [];
      for (const w of readers) w.resolve(() => {});
    }
  }
}
