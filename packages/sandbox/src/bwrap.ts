import type { FileSystemSandboxPolicy } from "@ao/protocol";
import { hasFullDiskWrite } from "./policy.ts";

export function bubblewrapArgs(policy: FileSystemSandboxPolicy): string[] {
  const rootBind = hasFullDiskWrite(policy)
    ? ["--bind", "/", "/"]
    : ["--ro-bind", "/", "/"];
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    ...rootBind,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  for (const root of policy.writableRoots) {
    if (root === "/") continue;
    args.push("--bind", root, root);
  }
  return args;
}
