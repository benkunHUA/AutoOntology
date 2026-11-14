/**
 * 工具并发门。
 *
 * 语义：可并行工具持读锁，独占工具持写锁。写者优先——
 * 有写者在等待时不再放新读者进入，避免独占工具被读请求饿死。
 */
type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

export class ReadWriteGate {
  private readers = 0;
  private writing = false;
  private waitingWriters: Waiter[] = [];
  private waitingReaders: Waiter[] = [];

  async acquireRead(signal?: AbortSignal): Promise<() => void> {
    if (this.writing || this.waitingWriters.length > 0) {
      await this.enqueue(this.waitingReaders, signal, "read");
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

  async acquireWrite(signal?: AbortSignal): Promise<() => void> {
    if (this.writing || this.readers > 0) {
      await this.enqueue(this.waitingWriters, signal, "write");
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
      const waiter = this.waitingWriters.shift()!;
      waiter.cleanup();
      this.writing = true;
      waiter.resolve(() => {});
      return;
    }
    if (this.readers === 0) {
      const readers = this.waitingReaders;
      this.waitingReaders = [];
      this.readers = readers.length;
      for (const w of readers) {
        w.cleanup();
        w.resolve(() => {});
      }
    }
  }

  private enqueue(
    queue: Waiter[],
    signal: AbortSignal | undefined,
    _kind: "read" | "write",
  ): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("aborted"));
    }
    return new Promise<() => void>((resolve, reject) => {
      let settled = false;
      const waiter: Waiter = {
        resolve: (release) => {
          if (settled) return;
          settled = true;
          waiter.cleanup();
          resolve(release);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          waiter.cleanup();
          reject(error);
        },
        cleanup: () => {
          if (signal) signal.removeEventListener("abort", onAbort);
        },
      };
      const onAbort = () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        waiter.reject(signal!.reason ?? new Error("aborted"));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
    });
  }
}
