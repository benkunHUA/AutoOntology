import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { FileNode, FilePreview } from "../shared/ipc.ts";

const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "build",
  "target",
]);

const MAX_TREE_ENTRIES = 2400;
const MAX_PREVIEW_BYTES = 256 * 1024;

export async function buildFileTree(rootPath: string): Promise<FileNode> {
  const root = resolve(rootPath);
  const state = { entries: 0, truncated: false };
  const children = await walkDirectory(root, root, 0, state);
  return {
    name: basename(root) || root,
    path: root,
    type: "directory",
    children,
    truncated: state.truncated,
  };
}

export async function previewFile(path: string): Promise<FilePreview | null> {
  const target = resolve(path);
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    if (info.size > MAX_PREVIEW_BYTES * 4) {
      return {
        path: target,
        content: "",
        binary: false,
        truncated: true,
        size: info.size,
      };
    }

    const buffer = await readFile(target);
    const binary = containsNullByte(buffer);
    const content = binary
      ? ""
      : buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf8");
    return {
      path: target,
      content,
      binary,
      truncated: buffer.length > MAX_PREVIEW_BYTES,
      size: buffer.length,
    };
  } catch {
    return null;
  }
}

async function walkDirectory(
  root: string,
  current: string,
  depth: number,
  state: { entries: number; truncated: boolean },
): Promise<FileNode[]> {
  if (depth > 9 || state.entries >= MAX_TREE_ENTRIES) {
    state.truncated = true;
    return [];
  }

  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  const sorted = [...entries].sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    return aDir - bDir || a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (entry.name.startsWith(".") && entry.name !== ".ao") continue;
    if (IGNORED_NAMES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    if (state.entries >= MAX_TREE_ENTRIES) {
      state.truncated = true;
      break;
    }

    const absolute = join(current, entry.name);
    state.entries += 1;

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: absolute,
        type: "directory",
        children: await walkDirectory(root, absolute, depth + 1, state),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: absolute,
        type: "file",
      });
    }
  }

  return nodes;
}

function containsNullByte(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}
