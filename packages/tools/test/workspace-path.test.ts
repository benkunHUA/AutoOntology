import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/workspace-path.ts";

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
});
