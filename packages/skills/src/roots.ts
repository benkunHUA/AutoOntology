/**
 * 技能根目录解析。
 *
 * 当前只解析 cwd/.ontology/skills 一个来源，目录不存在返回空；
 * 后续扩展来源时，在此维护发现顺序与路径去重规则。
 */
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
