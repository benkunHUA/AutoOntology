import { readFile as fsReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolHandler } from "@ao/protocol";

const MAX_CHARS = 60_000;

export const readFile: ToolHandler = {
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

  async execute(args, ctx) {
    const path = resolve(ctx.cwd, String(args.path ?? ""));
    if (!path.startsWith(ctx.cwd)) {
      return { ok: false, output: `path escapes workspace: ${args.path}` };
    }
    try {
      const content = await fsReadFile(path, "utf8");
      return {
        ok: true,
        output:
          content.length > MAX_CHARS
            ? `${content.slice(0, MAX_CHARS)}\n…[truncated]`
            : content,
      };
    } catch (error) {
      return { ok: false, output: (error as Error).message };
    }
  },
};
