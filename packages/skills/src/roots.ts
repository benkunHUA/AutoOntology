/** 解析技能根目录；当前只返回 cwd/.ontology/skills。 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SkillRoot } from "./types.ts";

export interface RootResolverContext {
  cwd: string;
}

export function resolveSkillRoots(ctx: RootResolverContext): SkillRoot[] {
  const cwd = resolve(ctx.cwd);
  const ontologySkillsDir = join(cwd, ".ontology", "skills");
  if (!existsSync(ontologySkillsDir)) return [];
  return [{ path: ontologySkillsDir, scope: "repo" }];
}
