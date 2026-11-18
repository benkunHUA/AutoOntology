import type {
  FileSystemSandboxPolicy,
  NetworkSandboxPolicy,
  PermissionProfile,
  SandboxablePreference,
} from "@ao/protocol";

export function hasDeniedReads(policy: FileSystemSandboxPolicy): boolean {
  return policy.deniedReads.length > 0;
}

export function hasFullDiskWrite(policy: FileSystemSandboxPolicy): boolean {
  return policy.kind === "unrestricted" || policy.writableRoots.includes("/");
}

export function unsandboxedExecutionAllowed(
  policy: FileSystemSandboxPolicy,
): boolean {
  return !hasDeniedReads(policy);
}

export function shouldSandbox(
  preference: SandboxablePreference,
  policy: PermissionProfile,
): boolean {
  if (preference === "require") return true;
  if (preference === "forbid") return false;
  if (!policy.network.enabled) return true;
  return (
    policy.filesystem.kind === "restricted" &&
    !hasFullDiskWrite(policy.filesystem)
  );
}

export function isNetworkAllowed(
  host: string,
  policy: NetworkSandboxPolicy,
): boolean {
  if (!policy.enabled) return false;
  const normalized = host.toLowerCase();
  if (policy.deniedHosts?.some((entry) => hostMatches(normalized, entry))) {
    return false;
  }
  if (
    policy.allowedHosts &&
    policy.allowedHosts.length > 0 &&
    !policy.allowedHosts.some((entry) => hostMatches(normalized, entry))
  ) {
    return false;
  }
  return true;
}

function hostMatches(host: string, pattern: string): boolean {
  const normalized = pattern.toLowerCase();
  if (normalized === host) return true;
  if (normalized.startsWith("*.")) {
    return host.endsWith(normalized.slice(1));
  }
  if (normalized.startsWith(".")) {
    return host.endsWith(normalized);
  }
  return false;
}
