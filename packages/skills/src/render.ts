/**
 * 可用技能目录渲染。
 *
 * 将目录渲染为 developer 片段，按预算依次降级为带描述、仅名称、
 * 截断并提示省略数量；单条描述截断到 1024 字符。
 */
import {
  DEFAULT_CATALOG_BUDGET_CHARS,
  MAX_DESCRIPTION_CHARS,
} from "./limits.ts";
import type { SkillCatalogLike, SkillCatalogEntry } from "./types.ts";

export interface RenderOptions {
  budgetChars?: number;
  omitDescriptions?: boolean;
}

function describe(entry: SkillCatalogEntry, omit: boolean): string {
  if (omit) return "";
  return `: ${(entry.shortDescription ?? entry.description).slice(0, MAX_DESCRIPTION_CHARS)}`;
}

export function renderAvailableSkills(
  catalog: SkillCatalogLike,
  options: RenderOptions = {},
): string {
  const budget = options.budgetChars ?? DEFAULT_CATALOG_BUDGET_CHARS;
  const visible = catalog.visible();
  const header = ["## Skills", "", "### Available skills"];
  const omit = options.omitDescriptions === true;

  const full = [
    ...header,
    ...visible.map((entry) => `- ${entry.name}${describe(entry, omit)}`),
  ].join("\n");
  if (full.length <= budget) return full;

  const minimal = visible.map((entry) => `- ${entry.name}`);
  const compact = [...header, ...minimal];
  if (compact.join("\n").length <= budget) return compact.join("\n");

  const lines = [...header];
  let used = lines.join("\n").length;
  let kept = 0;
  for (const row of minimal) {
    if (used + row.length + 1 > budget) break;
    lines.push(row);
    used += row.length + 1;
    kept++;
  }
  const omitted = minimal.length - kept;
  if (omitted > 0) lines.push(`- (${omitted} additional skills omitted)`);
  return lines.join("\n");
}
