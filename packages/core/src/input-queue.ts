/**
 * 待处理输入队列（对应设计 InputQueue）。
 *
 * 输入只在两个采样步骤之间被消费（drain）；运行中的回合通过 hasPending
 * 判断「是否要再走一步」。即时中断（提前打断流）属 M2 增强，骨架未启用。
 */
export interface PendingInput {
  text: string;
  at: string;
}

export class InputQueue {
  private items: PendingInput[] = [];
  private activityListeners = new Set<(pending: number) => void>();

  push(text: string): void {
    this.items.push({ text, at: new Date().toISOString() });
    for (const listener of this.activityListeners) listener(this.items.length);
  }

  /** 取走全部待处理输入（步骤边界调用）。 */
  drain(): PendingInput[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }

  hasPending(): boolean {
    return this.items.length > 0;
  }

  get size(): number {
    return this.items.length;
  }

  onActivity(listener: (pending: number) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }
}
