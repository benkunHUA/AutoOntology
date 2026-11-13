/**
 * exec_command：在 cwd 下执行 shell 命令。
 *
 * 声明为可并行（读锁）——它只启动进程，本身不改引擎状态；
 * 真正的写副作用由 M3 的沙箱/审批层兜底。
 */
import { execFile } from "node:child_process";
import type { ToolHandler } from "@ao/protocol";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 1_000_000;

export const execCommand: ToolHandler = {
  spec: {
    name: "exec_command",
    description:
      "Execute a shell command in the workspace. Returns combined stdout/stderr.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Shell command to run." },
        workdir: {
          type: "string",
          description: "Working directory relative to session cwd. Defaults to cwd.",
        },
      },
      required: ["cmd"],
      additionalProperties: false,
    },
    supportsParallel: true,
  },

  execute(args, ctx) {
    const cmd = String(args.cmd ?? "");
    if (!cmd) return Promise.resolve({ ok: false, output: "cmd is required" });
    const workdir =
      typeof args.workdir === "string" && args.workdir.length > 0
        ? `${ctx.cwd}/${args.workdir}`
        : ctx.cwd;

    return new Promise((resolve) => {
      execFile(
        "/bin/sh",
        ["-c", cmd],
        {
          cwd: workdir,
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          signal: ctx.signal,
        },
        (error, stdout, stderr) => {
          const output = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
          if (error) {
            const code = (error as NodeJS.ErrnoException & { code?: number }).code;
            resolve({
              ok: false,
              output: `${output}\n[exit ${code ?? "signal"}] ${error.message}`.trim(),
            });
            return;
          }
          resolve({ ok: true, output: output || "[no output]" });
        },
      );
    });
  },
};
