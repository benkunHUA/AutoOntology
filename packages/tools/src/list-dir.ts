import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolHandler } from "@ao/protocol";

export const listDir: ToolHandler = {
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

  async execute(args, ctx) {
    const path = resolve(ctx.cwd, String(args.path ?? "."));
    if (!path.startsWith(ctx.cwd)) {
      return { ok: false, output: `path escapes workspace: ${args.path}` };
    }
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { ok: true, output: lines.join("\n") || "[empty]" };
    } catch (error) {
      return { ok: false, output: (error as Error).message };
    }
  },
};
