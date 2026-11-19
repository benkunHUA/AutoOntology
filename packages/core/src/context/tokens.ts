/**
 * 粗略 token 估算与截断。
 *
 * 按 UTF-8 字节 / 4 估算，
 * 历史条目额外计入少量协议开销，保证压缩阈值判断与真实开销同向变化。
 */
import type { HistoryItem } from "@ao/protocol";

const BYTES_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
const FUNCTION_CALL_OVERHEAD_TOKENS = 8;
const TURN_MARKER_OVERHEAD_TOKENS = 3;

export function approxTokenCount(text: string): number {
  const bytes = new TextEncoder().encode(text).length;
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

export function estimateItemTokenCount(item: HistoryItem): number {
  switch (item.type) {
    case "message":
      return approxTokenCount(item.text) + MESSAGE_OVERHEAD_TOKENS;
    case "function_call":
      return (
        approxTokenCount(item.name) +
        approxTokenCount(item.arguments) +
        FUNCTION_CALL_OVERHEAD_TOKENS
      );
    case "function_call_output":
      return approxTokenCount(item.output) + MESSAGE_OVERHEAD_TOKENS;
    case "turn_marker":
      return approxTokenCount(item.detail) + TURN_MARKER_OVERHEAD_TOKENS;
  }
}

export interface TextTruncation {
  text: string;
  truncated: boolean;
}

/** 按 token 预算截断文本；截断时保留开头并追加省略标记。 */
export function truncateTextToTokenBudget(
  text: string,
  maxTokens: number,
): TextTruncation {
  if (maxTokens <= 0) return { text: "", truncated: text.length > 0 };
  if (approxTokenCount(text) <= maxTokens) {
    return { text, truncated: false };
  }

  const ellipsisBytes = new TextEncoder().encode("...").length;
  const maxContentBytes = maxTokens * BYTES_PER_TOKEN - ellipsisBytes;
  let bytes = 0;
  let index = 0;
  const encoder = new TextEncoder();
  for (const char of text) {
    const charBytes = encoder.encode(char).length;
    if (bytes + charBytes > maxContentBytes) break;
    bytes += charBytes;
    index += char.length;
  }

  if (index === 0) return { text: "", truncated: true };
  return { text: `${text.slice(0, index)}...`, truncated: true };
}
