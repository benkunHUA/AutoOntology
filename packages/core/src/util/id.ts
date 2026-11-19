/** 会话与线程标识生成。 */

export function newId(): string {
  return crypto.randomUUID();
}

