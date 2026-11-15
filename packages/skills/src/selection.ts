/** 从输入中按 $mention 或路径显式选择技能。 */
import type { SkillCatalogLike, SkillCatalogEntry, SkillInput } from "./types.ts";

export const MENTION_PATTERN = /(?:\[)?\$([A-Za-z0-9_:-]+)(?:\]\(([^)]+)\))?/g;

export function normalizeSkillPath(path: string): string {
  return path.replace(/^skill:\/\//, "");
}

export function selectExplicitSkills(
  inputs: readonly SkillInput[],
  catalog: SkillCatalogLike,
): SkillCatalogEntry[] {
  const byPath = new Map<string, SkillCatalogEntry>();
  const byName = new Map<string, SkillCatalogEntry[]>();

  for (const entry of catalog.entries) {
    if (!entry.enabled) continue;
    byPath.set(normalizeSkillPath(entry.mainPrompt), entry);
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }

  const selected: SkillCatalogEntry[] = [];
  const seen = new Set<string>();
  const push = (entry?: SkillCatalogEntry) => {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    selected.push(entry);
  };

  for (const input of inputs) {
    if (input.type === "skill") {
      if (input.path) push(byPath.get(normalizeSkillPath(input.path)));
      continue;
    }
    if (input.type === "text" && input.text) {
      for (const match of input.text.matchAll(MENTION_PATTERN)) {
        const path = match[2] && normalizeSkillPath(match[2]);
        if (path && byPath.has(path)) {
          push(byPath.get(path));
          continue;
        }
        const candidates = byName.get(match[1]) ?? [];
        if (candidates.length === 1) push(candidates[0]);
      }
    }
  }
  return selected;
}
