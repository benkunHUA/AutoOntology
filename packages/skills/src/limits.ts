export const MAX_SKILL_NAME_CHARS = 64;
export const MAX_DESCRIPTION_CHARS = 1024;
export const MAIN_PROMPT_BYTES = 8000;
export const SKILL_RESOURCE_BYTES = 1_048_576;
export const TOOL_RESPONSE_BYTES = 524_288;
export const SKILLS_LIST_PAGE_SIZE = 20;
export const MAX_SCAN_DEPTH = 6;
export const MAX_DIRS_PER_ROOT = 2000;
export const MAX_ENTRIES_PER_ROOT = 20000;
export const DEFAULT_CATALOG_BUDGET_CHARS = 8000;

/** 返回不超过 maxBytes 的最长 UTF-8 字符前缀。 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}
