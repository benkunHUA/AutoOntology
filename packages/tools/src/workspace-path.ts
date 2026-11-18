/**
 * 工作区路径收容：所有按「相对 session cwd」解释的路径都经这里归一化，
 * 避免 `path.startsWith(cwd)` 把 /workspace2 误判成 /workspace 内。
 */
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/**
 * 在词法收容之上再按真实路径校验，防止工作区内符号链接把读写带出边界。
 * allowMissing 用于写入路径：文件尚不存在时，沿最近的已存在祖先解析。
 */
export async function resolveWorkspacePathSafe(
  cwd: string,
  input: string,
  options: { allowMissing?: boolean } = {},
): Promise<WorkspacePath> {
  const lexical = resolveWorkspacePath(cwd, input);
  if (!lexical.ok) return lexical;

  try {
    const [workspaceReal, candidate] = await Promise.all([
      realpath(cwd),
      resolveExistingPath(lexical.path, options.allowMissing === true),
    ]);
    if (candidate === workspaceReal || candidate.startsWith(workspaceReal + sep)) {
      return lexical;
    }
    return { ok: false, reason: `path escapes workspace: ${input}` };
  } catch {
    return { ok: false, reason: `cannot resolve path: ${input}` };
  }
}

async function resolveExistingPath(
  target: string,
  allowMissing: boolean,
): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    if (!allowMissing) throw error;
    const parent = dirname(target);
    if (parent === target) throw error;
    const resolvedParent = await resolveExistingPath(parent, true);
    return join(resolvedParent, basename(target));
  }
}
