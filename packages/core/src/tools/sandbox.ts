/**
 * 沙箱管理器：为命令执行提供操作系统级文件写隔离。
 *
 * macOS 使用 seatbelt（sandbox-exec）；未支持的平台 fail-closed，
 * 不提供无沙箱降级。
 */
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import type {
  SandboxCommandOptions,
  SandboxedCommandResult,
  SandboxManager,
} from "@ao/protocol";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export class SandboxDeniedError extends Error {
  constructor(detail: string) {
    super(detail || "sandbox denied the command");
    this.name = "SandboxDeniedError";
  }
}

function seatbeltProfile(cwd: string): string {
  const escaped = cwd.replace(/([\\"])/g, "\\$1");
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "${escaped}"))
`;
}

function isSandboxDenied(stderr: string): boolean {
  return /operation not permitted|deny\(1\)/i.test(stderr);
}

class MacSandboxManager implements SandboxManager {
  readonly available = process.platform === "darwin";

  run(
    command: string,
    args: string[],
    options: SandboxCommandOptions,
  ): Promise<SandboxedCommandResult> {
    return new Promise((resolve, reject) => {
      if (!this.available) {
        reject(new Error("sandbox unavailable on this platform"));
        return;
      }
      execFile(
        SANDBOX_EXEC,
        ["-p", seatbeltProfile(realpathSync(options.cwd)), command, ...args],
        {
          cwd: options.cwd,
          signal: options.signal,
          timeout: options.timeoutMs,
          maxBuffer: options.maxBuffer,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (options.signal.aborted) {
              reject(options.signal.reason ?? new Error("aborted"));
              return;
            }
            if (isSandboxDenied(stderr)) {
              reject(new SandboxDeniedError(stderr.trim()));
              return;
            }
            const code = (error as NodeJS.ErrnoException & { code?: unknown })
              .code;
            resolve({
              code: typeof code === "number" ? code : 1,
              stdout,
              stderr,
              killed:
                (error as NodeJS.ErrnoException & { killed?: boolean })
                  .killed === true,
            });
            return;
          }
          resolve({ code: 0, stdout, stderr });
        },
      );
    });
  }
}

export function createSandboxManager(): SandboxManager {
  return new MacSandboxManager();
}
