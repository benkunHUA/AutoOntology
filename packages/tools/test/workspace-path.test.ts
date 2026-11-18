import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveWorkspacePath,
  resolveWorkspacePathSafe,
} from "../src/workspace-path.ts";

describe("resolveWorkspacePath", () => {
  it("接受工作区内路径", () => {
    expect(resolveWorkspacePath("/ws", "src/a.ts")).toEqual({
      ok: true,
      path: "/ws/src/a.ts",
    });
    expect(resolveWorkspacePath("/ws", ".").ok).toBe(true);
  });

  it("拒绝上级目录、绝对路径与同名前缀", () => {
    expect(resolveWorkspacePath("/ws", "../etc").ok).toBe(false);
    expect(resolveWorkspacePath("/ws", "/etc").ok).toBe(false);
    // /ws2 不是 /ws 的前缀内路径
    expect(resolveWorkspacePath("/ws", "/ws2").ok).toBe(false);
  });

  it("安全解析拒绝指向工作区外的符号链接", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-wsp-"));
    const ws = join(root, "ws");
    const outside = join(root, "outside");
    await mkdir(ws, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(ws, "link"), "dir");

    expect(await resolveWorkspacePathSafe(ws, "link/secret.txt")).toEqual({
      ok: false,
      reason: expect.stringContaining("escapes"),
    });
  });

  it("安全解析允许工作区内的真实路径与待写入路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-wsp-"));
    const ws = join(root, "ws");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "a.ts"), "x", "utf8");

    expect(await resolveWorkspacePathSafe(ws, "src/a.ts")).toEqual({
      ok: true,
      path: join(ws, "src", "a.ts"),
    });
    expect(
      await resolveWorkspacePathSafe(ws, "src/new/file.ts", {
        allowMissing: true,
      }),
    ).toEqual({ ok: true, path: join(ws, "src", "new", "file.ts") });
  });
});
