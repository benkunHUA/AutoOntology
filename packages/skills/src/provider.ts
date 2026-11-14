import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { SkillCatalog } from "./catalog.ts";
import { discoverSkills } from "./discovery.ts";
import { SKILL_RESOURCE_BYTES } from "./limits.ts";
import type {
  SkillCatalogEntry,
  SkillListQuery,
  SkillProvider,
  SkillReadRequest,
  SkillReadResult,
  SkillRoot,
  SkillSearchRequest,
  SkillSearchResult,
} from "./types.ts";

export interface HostSkillProviderOptions {
  roots: SkillRoot[];
  product?: string;
  disabledPaths?: ReadonlySet<string>;
  disabledNames?: ReadonlySet<string>;
}

export class HostSkillProvider implements SkillProvider {
  readonly kind = "host" as const;

  constructor(private readonly options: HostSkillProviderOptions) {}

  usesMcpResources(): boolean {
    return false;
  }

  async list(_query: SkillListQuery = {}): Promise<SkillCatalog> {
    const outcome = await discoverSkills({
      roots: this.options.roots,
      product: this.options.product,
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

  async search(_request: SkillSearchRequest): Promise<SkillSearchResult> {
    return { results: [] };
  }
}

function hostEntry(skill: {
  name: string;
  description: string;
  shortDescription?: string;
  pathToSkillMd: string;
  pluginId?: string;
}): SkillCatalogEntry {
  return {
    id: `skill://${skill.pathToSkillMd}`,
    authority: { kind: "host", id: "host" },
    name: skill.name,
    description: skill.description,
    shortDescription: skill.shortDescription,
    mainPrompt: skill.pathToSkillMd,
    displayPath: skill.pathToSkillMd,
    enabled: true,
    promptVisible: true,
    pluginId: skill.pluginId,
  };
}

function truncateBufferUtf8(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) return buffer;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end);
}
