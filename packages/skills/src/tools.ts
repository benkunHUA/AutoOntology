import type { ToolHandler, ToolResult } from "@ao/protocol";
import { SKILLS_LIST_PAGE_SIZE, TOOL_RESPONSE_BYTES } from "./limits.ts";
import type { SkillRuntime } from "./runtime.ts";

const AUTHORITIES = ["host", "executor", "cloud", "custom"] as const;

export function createSkillTools(runtime: SkillRuntime): ToolHandler[] {
  return [listSkills(runtime), readSkill(runtime)];
}

function listSkills(runtime: SkillRuntime): ToolHandler {
  return {
    spec: {
      name: "skills.list",
      description: "List skills available from a skill authority, with pagination.",
      parameters: {
        type: "object",
        properties: {
          authority: {
            type: "string",
            enum: [...AUTHORITIES],
            description: "Skill source to list.",
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous response.",
          },
        },
        required: ["authority"],
        additionalProperties: false,
      },
      supportsParallel: true,
    },
    async execute(args): Promise<ToolResult> {
      const step = runtime.currentStep;
      if (!step) return { ok: false, output: "skills not prepared" };
      const authority = String(args.authority);
      const offset = parseCursor(args.cursor);
      const entries = step.catalog.entries.filter(
        (entry) => entry.authority.kind === authority,
      );
      const page = entries.slice(offset, offset + SKILLS_LIST_PAGE_SIZE);
      const nextCursor =
        offset + page.length < entries.length
          ? String(offset + page.length)
          : null;
      return {
        ok: true,
        output: JSON.stringify({
          skills: page.map((entry) => ({
            authority: entry.authority,
            package: entry.id,
            name: entry.name,
            description: entry.shortDescription ?? entry.description,
            mainResource: entry.mainPrompt,
          })),
          nextCursor,
        }),
      };
    },
  };
}

function readSkill(runtime: SkillRuntime): ToolHandler {
  return {
    spec: {
      name: "skills.read",
      description: "Read a skill resource by package id, with pagination.",
      parameters: {
        type: "object",
        properties: {
          package: {
            type: "string",
            description: "Skill package id (e.g. skill:///path/SKILL.md).",
          },
          resource: {
            type: "string",
            description: "Resource to read; defaults to the main SKILL.md.",
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous response.",
          },
        },
        required: ["package"],
        additionalProperties: false,
      },
      supportsParallel: true,
    },
    async execute(args): Promise<ToolResult> {
      const step = runtime.currentStep;
      if (!step) return { ok: false, output: "skills not prepared" };
      const pkg = String(args.package);
      const entry = step.catalog.entries.find((candidate) => candidate.id === pkg);
      if (!entry) return { ok: false, output: `unknown skill package: ${pkg}` };
      const provider = runtime.providerFor(entry.authority.kind);
      if (!provider) {
        return { ok: false, output: `no provider for ${entry.authority.kind}` };
      }
      const resource =
        typeof args.resource === "string" ? args.resource : entry.mainPrompt;
      try {
        const result = await provider.read({ entry, resource });
        const offset = parseCursor(args.cursor);
        const page = result.contents.slice(offset, offset + TOOL_RESPONSE_BYTES);
        const nextCursor =
          offset + page.length < result.contents.length
            ? String(offset + page.length)
            : null;
        return {
          ok: true,
          output: JSON.stringify({ resource, contents: page, nextCursor }),
        };
      } catch (error) {
        return {
          ok: false,
          output: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function parseCursor(cursor: unknown): number {
  const value = Number(String(cursor ?? "0"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
