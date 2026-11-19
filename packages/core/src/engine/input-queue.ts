/**
 * 待处理输入队列。
 *
 * 输入只在两个采样步骤之间被消费（drain）；运行中的回合通过 hasPending
 * 判断「是否要再走一步」。即时中断（提前打断流）暂未启用。
 */
export type PendingInputSource = "user" | "agent";

export interface PendingInput {
  text: string;
  at: string;
  source: PendingInputSource;
  sourcePath?: string;
}

export class InputQueue {
  private items: PendingInput[] = [];
  private readonly listeners = new Set<() => void>();

  push(text: string): void {
    this.enqueue({ text, source: "user" });
  }

  /** 队列型 agent 消息：不启动回合，只唤醒正在等待的活动。 */
  enqueueAgentMessage(text: string, sourcePath: string): void {
    this.enqueue({ text, source: "agent", sourcePath });
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

  hasAgentMessage(): boolean {
    return this.items.some((item) => item.source === "agent");
  }

  hasUserInput(): boolean {
    return this.items.some((item) => item.source === "user");
  }

  /** 订阅活动变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue(input: Omit<PendingInput, "at">): void {
    this.items.push({ ...input, at: new Date().toISOString() });
    for (const listener of this.listeners) listener();
  }
}
