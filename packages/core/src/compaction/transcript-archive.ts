import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HistoryItem } from "@ao/protocol";

const MARKER_PATTERN = /^\[\d+ messages archived at (.+)\]$/;

export interface TranscriptArchiveOptions {
  readonly dir: string;
}

/** 把完整对话按 JSONL 落盘，压缩后可据此恢复被替换掉的历史。 */
export class TranscriptArchive {
  readonly #dir: string;

  constructor(options: TranscriptArchiveOptions) {
    this.#dir = options.dir;
  }

  async write(messages: readonly HistoryItem[]): Promise<string> {
    await mkdir(this.#dir, { recursive: true });
    const filePath = path.resolve(
      this.#dir,
      `transcript_${randomUUID().replaceAll("-", "")}.jsonl`,
    );
    const lines = messages
      .map((message) => `${JSON.stringify(message)}\n`)
      .join("");
    await writeFile(filePath, lines, "utf8");
    return filePath;
  }

  async isMarker(message: HistoryItem | undefined): Promise<boolean> {
    if (!message || message.type !== "message" || message.role !== "user") {
      return false;
    }
    const candidate = MARKER_PATTERN.exec(message.text)?.[1];
    if (!candidate) return false;
    return this.#isFileInsideDir(candidate);
  }

  async #isFileInsideDir(candidate: string): Promise<boolean> {
    try {
      const [resolvedFile, resolvedDir] = await Promise.all([
        realpath(candidate),
        realpath(this.#dir),
      ]);
      if (
        resolvedFile !== resolvedDir &&
        !resolvedFile.startsWith(resolvedDir + path.sep)
      ) {
        return false;
      }
      return (await stat(resolvedFile)).isFile();
    } catch {
      return false;
    }
  }
}
