/**
 * 技能目录集合。
 *
 * 按 (authority, id, environmentId) 去重，提供合并与可见性过滤，
 * 是目录渲染与显式选择的统一数据入口。
 */
import type { SkillCatalogLike, SkillCatalogEntry } from "./types.ts";

export class SkillCatalog implements SkillCatalogLike {
  readonly entries: SkillCatalogEntry[] = [];
  readonly warnings: string[] = [];
  readonly isPartial: boolean;
  private readonly keys = new Set<string>();

  constructor(
    entries: SkillCatalogEntry[] = [],
    warnings: string[] = [],
    isPartial = false,
  ) {
    this.isPartial = isPartial;
    this.warnings.push(...warnings);
    for (const entry of entries) this.pushEntry(entry);
  }

  private key(entry: SkillCatalogEntry): string {
    return `${entry.authority.kind}:${entry.id}:${entry.environmentId ?? ""}`;
  }

  pushEntry(entry: SkillCatalogEntry): void {
    const key = this.key(entry);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.entries.push(entry);
  }

  extend(other: SkillCatalogLike): this {
    for (const entry of other.entries) this.pushEntry(entry);
    this.warnings.push(...other.warnings);
    return this;
  }

  visible(): SkillCatalogEntry[] {
    return this.entries.filter((entry) => entry.enabled && entry.promptVisible);
  }
}
