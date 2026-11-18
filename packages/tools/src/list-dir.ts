import { readdir } from "node:fs/promises";
import { resolveWorkspacePathSafe } from "./workspace-path.ts";
import { defineTool } from "./define-tool.ts";

export const listDir = defineTool({
  spec: {
    name: "list_dir",
    description: "List entries of a directory (non-recursive).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to session cwd. Defaults to cwd.",
        },
      },
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
    approvalAction: (args) => `list ${String(args.path ?? ".")}`,
  },

  async run(args, ctx) {
    const resolved = await resolveWorkspacePathSafe(ctx.cwd, String(args.path ?? "."));
    if (!resolved.ok) {
      return { ok: false, output: resolved.reason };
    }
    try {
      const entries = await readdir(resolved.path, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { ok: true, output: lines.join("\n") || "[empty]" };
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
      return { ok: false, output: (error as Error).message };
    }
  },
});
