import { execFile, execFileSync } from "node:child_process";
import type {
  PermissionProfile,
  SandboxablePreference,
  SandboxCommandOptions,
  SandboxedCommandResult,
  SandboxManager,
  SandboxType,
} from "@ao/protocol";
import { bubblewrapArgs } from "./bwrap.ts";
import { isLikelySandboxDenied, SandboxDeniedError } from "./denial.ts";
import { shouldSandbox } from "./policy.ts";
import { seatbeltProfile } from "./seatbelt.ts";
import { WindowsRestrictedTokenManager } from "./windows.ts";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const BWRAP_EXEC = "bwrap";

class MacSeatbeltManager implements SandboxManager {
  readonly type: SandboxType = "macos_seatbelt";
  readonly available = process.platform === "darwin";

  shouldSandbox(
    preference: SandboxablePreference,
    policy: PermissionProfile,
  ): boolean {
    return shouldSandbox(preference, policy);
  }

  run(
    command: string,
    args: string[],
    options: SandboxCommandOptions,
  ): Promise<SandboxedCommandResult> {
    return runSandboxed(
      SANDBOX_EXEC,
      ["-p", seatbeltProfile(options.policy, options.cwd), command, ...args],
      options,
      "macos_seatbelt",
    );
  }
}

class LinuxBubblewrapManager implements SandboxManager {
  readonly type: SandboxType = "linux_seccomp";
  readonly available = process.platform === "linux" && bubblewrapAvailable();

  shouldSandbox(
    preference: SandboxablePreference,
    policy: PermissionProfile,
  ): boolean {
    return shouldSandbox(preference, policy);
  }

  run(
    command: string,
    args: string[],
    options: SandboxCommandOptions,
  ): Promise<SandboxedCommandResult> {
    if (options.policy.deniedReads.length > 0) {
      return Promise.reject(
        new Error("denied-read sandboxing requires landlock, which is unavailable"),
      );
    }
    return runSandboxed(
      BWRAP_EXEC,
      [...bubblewrapArgs(options.policy), command, ...args],
      options,
      "linux_seccomp",
    );
  }
}

class UnavailableSandboxManager implements SandboxManager {
  readonly type: SandboxType = "none";
  readonly available = false;

  shouldSandbox(
    preference: SandboxablePreference,
    policy: PermissionProfile,
  ): boolean {
    return shouldSandbox(preference, policy);
  }

  run(
    _command: string,
    _args: string[],
    _options: SandboxCommandOptions,
  ): Promise<SandboxedCommandResult> {
    return Promise.reject(new Error("sandbox unavailable on this platform"));
  }
}

function bubblewrapAvailable(): boolean {
  try {
    execFileSync(BWRAP_EXEC, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runSandboxed(
  program: string,
  argv: string[],
  options: SandboxCommandOptions,
  sandboxType: SandboxType,
): Promise<SandboxedCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      argv,
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
          if (
            isLikelySandboxDenied(sandboxType, {
              code: null,
              stdout,
              stderr,
            })
          ) {
            reject(new SandboxDeniedError(stderr.trim()));
            return;
          }
          const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          resolve({
            code: typeof code === "number" ? code : 1,
            stdout,
            stderr,
            killed:
              (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true,
          });
          return;
        }
        resolve({ code: 0, stdout, stderr });
      },
    );
  });
}

export function createSandboxManager(): SandboxManager {
  if (process.platform === "darwin") return new MacSeatbeltManager();
  if (process.platform === "linux" && bubblewrapAvailable()) {
    return new LinuxBubblewrapManager();
  }
  if (process.platform === "win32") return new WindowsRestrictedTokenManager();
  return new UnavailableSandboxManager();
}
