/**
 * 本地文件系统的技能 Provider。
 *
 * 负责扫描发现（list）与按路径读取资源（read）；
 * 读取时校验 UTF-8，并按 1 MiB 上限截断。
 */
import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { SkillCatalog } from "./catalog.ts";
import { discoverSkills } from "./discovery.ts";
import { SKILL_RESOURCE_BYTES } from "./limits.ts";
import type {
  SkillCatalogEntry,
  SkillReadRequest,
  SkillReadResult,
  SkillRoot,
} from "./types.ts";

export interface HostSkillProviderOptions {
  roots: SkillRoot[];
  disabledPaths?: ReadonlySet<string>;
  disabledNames?: ReadonlySet<string>;
}

export class HostSkillProvider {
  constructor(private readonly options: HostSkillProviderOptions) {}

  async list(): Promise<SkillCatalog> {
    const outcome = await discoverSkills({
      roots: this.options.roots,
      disabledPaths: this.options.disabledPaths,
      disabledNames: this.options.disabledNames,
    });
    return new SkillCatalog(
      outcome.skills.map(hostEntry),
      outcome.warnings.map((warning) => `${warning.path}: ${warning.message}`),
      false,
    );
  }

  async read(request: SkillReadRequest): Promise<SkillReadResult> {
    const buffer = await readFile(request.resource);
    if (!isUtf8(buffer)) throw new Error("skill resource is not valid UTF-8");
    const capped = truncateBufferUtf8(buffer, SKILL_RESOURCE_BYTES);
    return {
      resource: request.resource,
      contents: capped.toString("utf8"),
      nextCursor: null,
    };
  }

}

function hostEntry(skill: {
  name: string;
  description: string;
  shortDescription?: string;
  pathToSkillMd: string;
}): SkillCatalogEntry {
  return {
    id: `skill://${skill.pathToSkillMd}`,
    authority: { kind: "host", id: "host" },
    name: skill.name,
    description: skill.description,
    shortDescription: skill.shortDescription,
    mainPrompt: skill.pathToSkillMd,
    enabled: true,
    promptVisible: true,
  };
}

function truncateBufferUtf8(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) return buffer;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end);
}
