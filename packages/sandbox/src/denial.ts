import type { SandboxedCommandResult, SandboxType } from "@ao/protocol";

const SANDBOX_DENIED_KEYWORDS = [
  "operation not permitted",
  "permission denied",
  "read-only file system",
  "seccomp",
  "sandbox",
  "landlock",
  "failed to write file",
];

const QUICK_REJECT_EXIT_CODES = new Set([2, 126, 127]);
const SIGSYS_EXIT_CODE = 128 + 31;

export class SandboxDeniedError extends Error {
  constructor(detail: string) {
    super(detail || "sandbox denied the command");
    this.name = "SandboxDeniedError";
  }
}

export function isLikelySandboxDenied(
  sandboxType: SandboxType,
  result: SandboxedCommandResult,
): boolean {
  if (sandboxType === "none" || result.code === 0) return false;
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (SANDBOX_DENIED_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true;
  }
  if (result.code !== null && QUICK_REJECT_EXIT_CODES.has(result.code)) {
    return false;
  }
  return sandboxType === "linux_seccomp" && result.code === SIGSYS_EXIT_CODE;
}
