/** write_file：独占工具（默认写锁），创建或覆盖文件。 */
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveWorkspacePathSafe } from "./workspace-path.ts";
import { defineTool } from "./define-tool.ts";

export const writeFile = defineTool({
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
  sandboxable: {
    sandboxPreference: () => "auto",
    escalateOnFailure: () => true,
  },
  approvable: {
    sandboxPermissions: () => "use_default",
    execApprovalRequirement: () => "needs_approval",
    approvalAction: (args) => `write ${String(args.path ?? "")}`,
  },

  async run(args, ctx) {
    const resolved = await resolveWorkspacePathSafe(
      ctx.cwd,
      String(args.path ?? ""),
      { allowMissing: true },
    );
    if (!resolved.ok) {
      return { ok: false, output: resolved.reason };
    }
    try {
      await mkdir(dirname(resolved.path), { recursive: true });
      const content = String(args.content ?? "");
      await fsWriteFile(resolved.path, content, {
        encoding: "utf8",
        signal: ctx.signal,
      });
      return { ok: true, output: `wrote ${content.length} chars to ${args.path}` };
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
      return { ok: false, output: (error as Error).message };
    }
  },
});
