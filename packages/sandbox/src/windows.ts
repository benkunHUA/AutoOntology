import type {
  PermissionProfile,
  SandboxablePreference,
  SandboxCommandOptions,
  SandboxedCommandResult,
  SandboxManager,
  SandboxType,
} from "@ao/protocol";
import { shouldSandbox } from "./policy.ts";

/**
 * Windows restricted-token 沙箱需要外部 helper 可执行文件。
 * 未提供 helper 时 fail-closed，不降级为无沙箱执行。
 */
export class WindowsRestrictedTokenManager implements SandboxManager {
  readonly type: SandboxType = "windows_restricted_token";
  readonly available =
    process.platform === "win32" && Boolean(process.env.AO_WINDOWS_SANDBOX_EXE);

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
    const helper = process.env.AO_WINDOWS_SANDBOX_EXE;
    if (!this.available || !helper) {
      return Promise.reject(new Error("windows sandbox helper is unavailable"));
    }
    return Promise.reject(
      new Error("windows restricted-token helper execution is not yet implemented"),
    );
  }
}
