/** write_file：独占工具（默认写锁），创建或覆盖文件。 */
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ToolHandler } from "@ao/protocol";

export const writeFile: ToolHandler = {
  spec: {
    name: "write_file",
    description: "Create or overwrite a UTF-8 text file with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to session cwd." },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    // 未声明 supportsParallel → 独占写锁
  },

  async execute(args, ctx) {
    const path = resolve(ctx.cwd, String(args.path ?? ""));
    if (!path.startsWith(ctx.cwd)) {
      return { ok: false, output: `path escapes workspace: ${args.path}` };
    }
    try {
      await mkdir(dirname(path), { recursive: true });
      const content = String(args.content ?? "");
      await fsWriteFile(path, content, "utf8");
      return { ok: true, output: `wrote ${content.length} chars to ${args.path}` };
    } catch (error) {
      return { ok: false, output: (error as Error).message };
    }
  },
};
