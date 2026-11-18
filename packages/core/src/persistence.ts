/**
 * 会话持久化入口：canonical append-only JSONL。
 */
import { join } from "node:path";

export * from "./session-store.ts";

/** 按 sessionId/threadId 生成 canonical 会话文件路径。 */
export function threadPersistencePath(
  rootDir: string,
  sessionId: string,
  threadId: string,
): string {
  return join(rootDir, sessionId, `${threadId}.jsonl`);
}
