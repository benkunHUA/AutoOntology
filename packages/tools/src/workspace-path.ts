/**
 * 工作区路径收容：所有按「相对 session cwd」解释的路径都经这里归一化，
 * 避免 `path.startsWith(cwd)` 把 /workspace2 误判成 /workspace 内。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

export type WorkspacePath =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export function resolveWorkspacePath(
  cwd: string,
  input: string,
): WorkspacePath {
  const target = input.trim() === "" ? cwd : resolve(cwd, input);
  const rel = relative(cwd, target);
  if (rel === "") return { ok: true, path: target };
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, reason: `path escapes workspace: ${input}` };
  }
  return { ok: true, path: target };
}
