import { describe, expect, it } from "vitest";
import { ReadWriteGate } from "../src/tools/gate.ts";

describe("ReadWriteGate", () => {
  it("多个读者可并发", async () => {
    const gate = new ReadWriteGate();
    const r1 = await gate.acquireRead();
    const r2 = await gate.acquireRead(); // 不阻塞
    r1();
    r2();
  });

  it("写者等待所有读者结束", async () => {
    const gate = new ReadWriteGate();
    const releaseRead = await gate.acquireRead();

    let wrote = false;
    const writePromise = gate.acquireWrite().then((release) => {
      wrote = true;
      return release;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(wrote).toBe(false);

    releaseRead();
    (await writePromise)();
    expect(wrote).toBe(true);
  });

  it("写者优先：等待中的写者阻塞新读者", async () => {
    const gate = new ReadWriteGate();
    const releaseRead = await gate.acquireRead();

    let writerGranted = false;
    const writePromise = gate.acquireWrite().then((release) => {
      writerGranted = true;
      return release;
    });

    // 写者在等待时，新读者不能越过
    let readerGranted = false;
    const readPromise = gate.acquireRead().then((release) => {
      readerGranted = true;
      return release;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(readerGranted).toBe(false);
    expect(writerGranted).toBe(false);

    releaseRead();
    const releaseWrite = await writePromise;
    await new Promise((r) => setTimeout(r, 10));
    expect(writerGranted).toBe(true);
    expect(readerGranted).toBe(false);

    releaseWrite();
    (await readPromise)();
    expect(readerGranted).toBe(true);
  });

  it("重复释放是幂等的", async () => {
    const gate = new ReadWriteGate();
    const release = await gate.acquireWrite();
    release();
    release(); // 不应把 writing 置成负数/异常
    const r = await gate.acquireWrite();
    r();
  });
});
