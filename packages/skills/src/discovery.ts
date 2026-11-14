import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  MAX_DIRS_PER_ROOT,
  MAX_ENTRIES_PER_ROOT,
  MAX_SCAN_DEPTH,
} from "./limits.ts";
import { DEFAULT_POLICY, parseAgentPolicy } from "./policy.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type {
  SkillLoadOutcome,
  SkillMetadata,
  SkillRoot,
} from "./types.ts";

export const SKILL_FILENAME = "SKILL.md";

interface ScanCounters {
  dirs: number;
  entries: number;
  truncated: boolean;
}

export async function* walkSkillFiles(
  dir: string,
  depth = 0,
  counters: ScanCounters = { dirs: 0, entries: 0, truncated: false },
): AsyncGenerator<string> {
  if (
    depth > MAX_SCAN_DEPTH ||
    counters.dirs > MAX_DIRS_PER_ROOT ||
    counters.entries > MAX_ENTRIES_PER_ROOT
  ) {
    return;
  }
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  counters.dirs++;
  for (const entry of dirents) {
    counters.entries++;
    if (counters.entries > MAX_ENTRIES_PER_ROOT) {
      counters.truncated = true;
      return;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      yield* walkSkillFiles(path, depth + 1, counters);
    } else if (entry.name === SKILL_FILENAME) {
      yield path;
    }
  }
}

const SCOPE_RANK: Record<string, number> = {
  repo: 0,
  user: 1,
  system: 2,
  admin: 3,
};

function compareSkills(a: SkillMetadata, b: SkillMetadata): number {
  const rank = (SCOPE_RANK[a.scope] ?? 3) - (SCOPE_RANK[b.scope] ?? 3);
  if (rank !== 0) return rank;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.pathToSkillMd.localeCompare(b.pathToSkillMd);
}

export interface DiscoverOptions {
  roots: SkillRoot[];
  product?: string;
  disabledPaths?: ReadonlySet<string>;
}

export async function discoverSkills(
  options: DiscoverOptions,
): Promise<SkillLoadOutcome> {
  const skills: SkillMetadata[] = [];
  const warnings: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  const disabled = await canonicalizePaths(options.disabledPaths);

  for (const root of options.roots) {
    const counters: ScanCounters = { dirs: 0, entries: 0, truncated: false };
    for await (const skillMd of walkSkillFiles(root.path, 0, counters)) {
      try {
        const canonical = await realpath(skillMd);
        if (seen.has(canonical) || disabled.has(canonical)) continue;
        const markdown = await readFile(canonical, "utf8");
        const meta = parseFrontmatter(markdown, basename(dirname(canonical)));
        const policy = await readAgentPolicy(dirname(canonical));
        if (
          policy.products.length &&
          options.product &&
          !policy.products.includes(options.product)
        ) {
          continue;
        }
        seen.add(canonical);
        skills.push({
          ...meta,
          ...policy,
          pathToSkillMd: canonical,
          scope: root.scope,
          pluginId: root.pluginId,
        });
      } catch (error) {
        warnings.push({
          path: skillMd,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (counters.truncated) {
      warnings.push({
        path: root.path,
        message: "scan truncated: per-root limit exceeded",
      });
    }
  }

  skills.sort(compareSkills);
  return { skills, warnings };
}

async function readAgentPolicy(skillDir: string) {
  try {
    return parseAgentPolicy(
      await readFile(join(skillDir, "agents", "openai.yaml"), "utf8"),
    );
  } catch {
    return DEFAULT_POLICY;
  }
}

async function canonicalizePaths(
  paths: ReadonlySet<string> | undefined,
): Promise<Set<string>> {
  const canonical = new Set<string>();
  for (const path of paths ?? []) {
    try {
      canonical.add(await realpath(path));
    } catch {
      canonical.add(resolve(path));
    }
  }
  return canonical;
}
