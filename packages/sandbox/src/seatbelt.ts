import { realpathSync } from "node:fs";
import type { FileSystemSandboxPolicy } from "@ao/protocol";
import { hasFullDiskWrite } from "./policy.ts";

function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function escapeProfilePath(path: string): string {
  return path.replace(/([\\"])/g, "\\$1");
}

export function seatbeltProfile(
  policy: FileSystemSandboxPolicy,
  cwd: string,
): string {
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
  ];
  const roots = hasFullDiskWrite(policy)
    ? []
    : policy.writableRoots.map(canonicalize);
  for (const root of roots) {
    lines.push(`(allow file-write* (subpath "${escapeProfilePath(root)}"))`);
  }
  for (const denied of policy.deniedReads) {
    lines.push(
      `(deny file-read* (subpath "${escapeProfilePath(canonicalize(denied))}"))`,
    );
  }
  if (roots.length === 0 && !hasFullDiskWrite(policy)) {
    lines.push(
      `(allow file-write* (subpath "${escapeProfilePath(canonicalize(cwd))}"))`,
    );
  }
  return `${lines.join("\n")}\n`;
}
