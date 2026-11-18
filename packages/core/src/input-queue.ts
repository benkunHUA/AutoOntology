/**
 * 待处理输入队列。
 *
 * 输入只在两个采样步骤之间被消费（drain）；运行中的回合通过 hasPending
 * 判断「是否要再走一步」。即时中断（提前打断流）暂未启用。
 */
export interface PendingInput {
  text: string;
  at: string;
}

export class InputQueue {
  private items: PendingInput[] = [];

  push(text: string): void {
    this.items.push({ text, at: new Date().toISOString() });
  }

  /** 取走全部待处理输入（步骤边界调用）。 */
  drain(): PendingInput[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }

  /** 只取队首，保留其余输入给下一个回合/步骤。 */
  takeFirst(): PendingInput | undefined {
    return this.items.shift();
  }

  hasPending(): boolean {
    return this.items.length > 0;
  }

  get size(): number {
    return this.items.length;
  }
}
