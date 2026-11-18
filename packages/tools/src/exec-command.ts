/**
 * exec_command：在 cwd 下执行 shell 命令。
 *
 * 命令可能写入工作区，声明为独占（写锁）：执行期间其他工具排队。
 */
import { execFile } from "node:child_process";
import type { ToolResult } from "@ao/protocol";
import { resolveWorkspacePathSafe } from "./workspace-path.ts";
import { defineTool } from "./define-tool.ts";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 1_000_000;

export const execCommand = defineTool({
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
    // 未声明 supportsParallel → 独占写锁。
    timeoutMs: TIMEOUT_MS,
  },
  sandboxable: {
    sandboxPreference: () => "sandboxed",
    escalateOnFailure: () => true,
  },
  approvable: {
    execApprovalRequirement: () => "needs_approval",
    approvalAction: (args, callId) => `exec ${callId}: ${String(args.cmd ?? "")}`,
  },

  async run(args, ctx) {
    const cmd = String(args.cmd ?? "");
    if (!cmd) return Promise.resolve({ ok: false, output: "cmd is required" });
    const requested = typeof args.workdir === "string" ? args.workdir : "";
    const resolved = await resolveWorkspacePathSafe(ctx.cwd, requested);
    if (!resolved.ok) {
      return Promise.resolve({ ok: false, output: resolved.reason });
    }

    if (ctx.sandboxOverride === "unsandboxed") {
      return runUnsandboxed(cmd, resolved.path, ctx);
    }

    if (!ctx.sandbox) {
      return Promise.resolve({ ok: false, output: "sandbox unavailable" });
    }

    return ctx.sandbox
      .run("/bin/sh", ["-c", cmd], {
        cwd: resolved.path,
        signal: ctx.signal,
        timeoutMs: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      })
      .then(({ code, stdout, stderr, killed }) => {
        const output = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
        if (code !== 0) {
          return {
            ok: false,
            output: `${output}\n[exit ${code ?? "signal"}${killed ? " killed" : ""}]`.trim(),
          };
        }
        return { ok: true, output: output || "[no output]" };
      });
  },
});

function runUnsandboxed(
  cmd: string,
  cwd: string,
  ctx: {
    signal: AbortSignal;
  },
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/sh",
      ["-c", cmd],
      {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        signal: ctx.signal,
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
        if (error) {
          if (ctx.signal.aborted) {
            reject(ctx.signal.reason ?? new Error("aborted"));
            return;
          }
          const code = (
            error as NodeJS.ErrnoException & { code?: number | string }
          ).code;
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
}
