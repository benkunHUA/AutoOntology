import type {
  SkillCatalogLike,
  SkillCatalogEntry,
  SkillSourceLocation,
} from "./types.ts";

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

function cloneEntry(entry: SkillCatalogEntry): SkillCatalogEntry {
  return {
    ...entry,
    sources: entry.sources ? entry.sources.map((source) => ({ ...source })) : undefined,
  };
}

function toSourceLocation(entry: SkillCatalogEntry): SkillSourceLocation {
  return {
    authority: entry.authority,
    package: { value: entry.id },
    mainPrompt: { uri: entry.mainPrompt, environmentId: entry.environmentId },
    displayPath: entry.displayPath ?? entry.mainPrompt,
    pluginId: entry.pluginId,
    enabled: entry.enabled,
    promptVisible: entry.promptVisible,
  };
}

export function mergeCatalogs(
  cloud: SkillCatalogLike | null,
  executor: SkillCatalogLike,
): SkillCatalog {
  if (!cloud) return executor as SkillCatalog;

  const entries = cloud.entries.map(cloneEntry);
  const byName = new Map(
    entries.map((entry) => [`${entry.remotePluginId ?? ""}:${entry.name}`, entry]),
  );
  const merged = new SkillCatalog(entries, [...cloud.warnings], cloud.isPartial);

  for (const entry of executor.entries) {
    const key = `${entry.remotePluginId ?? ""}:${entry.name}`;
    const target = byName.get(key);
    if (target) {
      target.sources = [...(target.sources ?? []), toSourceLocation(entry)];
      continue;
    }
    if (!cloud.isPartial) continue;
    merged.pushEntry(cloneEntry(entry));
  }
  return merged;
}
