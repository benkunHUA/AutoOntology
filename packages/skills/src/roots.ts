import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SkillRoot } from "./types.ts";

export interface RootResolverContext {
  cwd: string;
  codexHome?: string;
  home?: string;
  pluginRoots?: SkillRoot[];
  extraRoots?: SkillRoot[];
}

export function resolveSkillRoots(ctx: RootResolverContext): SkillRoot[] {
  const cwd = resolve(ctx.cwd);
  const codexHome = ctx.codexHome ?? process.env.CODEX_HOME;
  const home = resolve(ctx.home ?? homedir());
  const candidates: SkillRoot[] = [];

  candidates.push({ path: join(cwd, ".codex", "skills"), scope: "repo" });
  if (codexHome) {
    candidates.push({ path: join(codexHome, "skills"), scope: "user" });
  }
  candidates.push({ path: join(home, ".agents", "skills"), scope: "user" });
  if (codexHome) {
    candidates.push({ path: join(codexHome, "skills", ".system"), scope: "system" });
  }
  for (const root of ctx.pluginRoots ?? []) candidates.push(root);
  for (const root of ctx.extraRoots ?? []) candidates.push(root);

  for (let dir = cwd; ; dir = dirname(dir)) {
    candidates.push({ path: join(dir, ".agents", "skills"), scope: "repo" });
    if (dir === home) break;
    const parent = dirname(dir);
    if (parent === dir) break;
  }

  const seen = new Set<string>();
  const roots: SkillRoot[] = [];
  for (const candidate of candidates) {
    const path = resolve(candidate.path);
    if (!existsSync(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    roots.push({ ...candidate, path });
  }
  return roots;
}
