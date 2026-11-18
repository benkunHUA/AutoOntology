import { readFile as fsReadFile } from "node:fs/promises";
import { resolveWorkspacePathSafe } from "./workspace-path.ts";
import { defineTool } from "./define-tool.ts";

const MAX_CHARS = 60_000;

export const readFile = defineTool({
  spec: {
    name: "read_file",
    description: "Read a UTF-8 text file. Output is truncated past 60000 chars.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to session cwd." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    supportsParallel: true,
  },
  sandboxable: {
    sandboxPreference: () => "default",
    escalateOnFailure: () => true,
  },
  approvable: {
    execApprovalRequirement: () => "skip",
    approvalAction: (args) => `read ${String(args.path ?? "")}`,
  },

  async run(args, ctx) {
    const resolved = await resolveWorkspacePathSafe(ctx.cwd, String(args.path ?? ""));
    if (!resolved.ok) {
      return { ok: false, output: resolved.reason };
    }
    try {
      const content = await fsReadFile(resolved.path, {
        encoding: "utf8",
        signal: ctx.signal,
      });
      if (content.length <= MAX_CHARS) {
        return { ok: true, output: content };
      }
      const suffix = "\n…[truncated]";
      return {
        ok: true,
        output: `${content.slice(0, Math.max(0, MAX_CHARS - suffix.length))}${suffix}`,
        fallbackTokenLimitOverride: MAX_CHARS,
      };
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
      return { ok: false, output: (error as Error).message };
    }
  },
});
