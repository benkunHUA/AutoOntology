import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { charCount } from "./text.ts";
import {
  EARLIER_RESULT_PREFIX,
  LARGE_RESULT_CHAR_LIMIT,
  PERSISTED_FULL_OUTPUT_LINE,
  PERSISTED_OUTPUT_PREFIX,
  PERSIST_PREVIEW_CHARS,
} from "./types.ts";

const SAFE_ID_PATTERN = /[^A-Za-z0-9._-]/g;
const SAFE_ID_MAX_CHARS = 120;
const PERSISTED_OUTPUT_SUFFIX = "\n</persisted-output>";

export interface ToolResultStoreOptions {
  readonly dir: string;
}

/** 把超大工具输出落盘，并用可校验、可读回的占位文本替换。 */
export class ToolResultStore {
  readonly #dir: string;

  constructor(options: ToolResultStoreOptions) {
    this.#dir = options.dir;
  }

  async save(toolUseId: string, output: string): Promise<string> {
    await mkdir(this.#dir, { recursive: true });
    const safeId =
      toolUseId.replace(SAFE_ID_PATTERN, "_").slice(0, SAFE_ID_MAX_CHARS) ||
      "unknown";
    const filePath = path.resolve(this.#dir, `${safeId}.txt`);
    await writeFile(filePath, output, "utf8");
    return filePath;
  }

  async resolvePlaceholder(content: string): Promise<string | undefined> {
    let candidate: string | undefined;
    if (content.startsWith(PERSISTED_OUTPUT_PREFIX)) {
      for (const line of content.split("\n")) {
        if (line.startsWith(PERSISTED_FULL_OUTPUT_LINE)) {
          candidate = line.slice(PERSISTED_FULL_OUTPUT_LINE.length);
          break;
        }
      }
    }
    if (content.startsWith(EARLIER_RESULT_PREFIX) && content.endsWith("]")) {
      candidate = content.slice(EARLIER_RESULT_PREFIX.length, -1);
    }
    if (!candidate) return undefined;
    return this.#verifyInsideStore(candidate);
  }

  async persistedPreview(
    toolUseId: string,
    output: string,
    previewChars = PERSIST_PREVIEW_CHARS,
  ): Promise<string> {
    const existing = await this.resolvePlaceholder(output);
    let filePath: string;
    let preview: string;
    if (existing) {
      filePath = existing;
      try {
        preview = sliceCharacters(await readFile(existing, "utf8"), previewChars);
      } catch {
        preview = sliceCharacters(output, previewChars);
      }
    } else {
      filePath = await this.save(toolUseId, output);
      preview = sliceCharacters(output, previewChars);
    }
    return (
      `${PERSISTED_OUTPUT_PREFIX}` +
      `Full output: ${filePath}\n` +
      `Preview:\n${preview}${PERSISTED_OUTPUT_SUFFIX}`
    );
  }

  async persistLargeOutput(toolUseId: string, output: string): Promise<string> {
    if (charCount(output) <= LARGE_RESULT_CHAR_LIMIT) return output;
    return this.persistedPreview(toolUseId, output);
  }

  async #verifyInsideStore(candidate: string): Promise<string | undefined> {
    try {
      const [resolvedFile, resolvedDir] = await Promise.all([
        realpath(candidate),
        realpath(this.#dir),
      ]);
      if (
        resolvedFile !== resolvedDir &&
        !resolvedFile.startsWith(resolvedDir + path.sep)
      ) {
        return undefined;
      }
      return (await stat(resolvedFile)).isFile() ? candidate : undefined;
    } catch {
      return undefined;
    }
  }
}

function sliceCharacters(text: string, chars: number): string {
  return Array.from(text).slice(0, chars).join("");
}
