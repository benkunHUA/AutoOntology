import { describe, expect, it } from "vitest";
import type { PermissionProfile } from "@ao/protocol";
import {
  bubblewrapArgs,
  decodeFrame,
  encodeFrame,
  hasFullDiskWrite,
  isLikelySandboxDenied,
  isNetworkAllowed,
  seatbeltProfile,
  shouldSandbox,
} from "@ao/sandbox";
import {
  workspacePermissionProfile,
} from "../src/tools/orchestrator.ts";

function profile(
  overrides: Partial<PermissionProfile["filesystem"]> = {},
): PermissionProfile {
  return {
    ...workspacePermissionProfile("/ws"),
    filesystem: {
      kind: "restricted",
      writableRoots: ["/ws"],
      deniedReads: [],
      ...overrides,
    },
  };
}

describe("sandbox selection", () => {
  it("require 强制沙箱，forbid 禁用沙箱", () => {
    expect(shouldSandbox("require", profile())).toBe(true);
    expect(shouldSandbox("forbid", profile())).toBe(false);
  });

  it("auto 在禁网或受限文件系统时需要沙箱", () => {
    expect(shouldSandbox("auto", profile())).toBe(true);
    expect(shouldSandbox("auto", { ...profile(), network: { enabled: true } })).toBe(true);
    expect(
      shouldSandbox("auto", {
        ...profile(),
        filesystem: { kind: "unrestricted", writableRoots: [], deniedReads: [] },
        network: { enabled: true },
      }),
    ).toBe(false);
  });
});

describe("denial classification", () => {
  it("识别关键字、快速排除常见 shell 退出码、识别 SIGSYS", () => {
    expect(
      isLikelySandboxDenied("macos_seatbelt", {
        code: 1,
        stdout: "",
        stderr: "Operation not permitted",
      }),
    ).toBe(true);
    expect(
      isLikelySandboxDenied("macos_seatbelt", {
        code: 126,
        stdout: "",
        stderr: "",
      }),
    ).toBe(false);
    expect(
      isLikelySandboxDenied("linux_seccomp", {
        code: 128 + 31,
        stdout: "",
        stderr: "",
      }),
    ).toBe(true);
  });
});

describe("platform profiles", () => {
  it("seatbelt 允许工作区写入并拒绝 denied-read", () => {
    const policy = seatbeltProfile(profile().filesystem, "/ws");
    expect(policy).toContain("(allow default)");
    expect(policy).toContain("(deny file-write*)");
    expect(policy).toContain('(allow file-write* (subpath "/ws"))');

    const denied = profile({
      writableRoots: ["/ws"],
      deniedReads: ["/ws/.env"],
    });
    const text = seatbeltProfile(denied.filesystem, "/ws");
    expect(text).toContain('(deny file-read* (subpath "/ws/.env"))');
  });

  it("bubblewrap 默认只读根并绑定可写根", () => {
    const args = bubblewrapArgs(profile().filesystem);
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).toContain("/ws");
  });

  it("unrestricted 政策视为全盘可写", () => {
    expect(
      hasFullDiskWrite({
        kind: "unrestricted",
        writableRoots: [],
        deniedReads: [],
      }),
    ).toBe(true);
  });

  it("按 allow/deny 主机列表判定网络访问", () => {
    expect(isNetworkAllowed("example.com", { enabled: false })).toBe(false);
    expect(isNetworkAllowed("example.com", { enabled: true })).toBe(true);
    expect(
      isNetworkAllowed("evil.example.com", {
        enabled: true,
        deniedHosts: ["*.example.com"],
      }),
    ).toBe(false);
    expect(
      isNetworkAllowed("api.example.com", {
        enabled: true,
        allowedHosts: ["*.example.com"],
      }),
    ).toBe(true);
    expect(
      isNetworkAllowed("other.com", {
        enabled: true,
        allowedHosts: ["*.example.com"],
      }),
    ).toBe(false);
  });

  it("Windows helper 帧按长度前缀往返编码", () => {
    const frame = encodeFrame({ type: "run", cmd: ["echo", "hi"] });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(decodeFrame<{ type: string; cmd: string[] }>(frame)).toEqual({
      message: { type: "run", cmd: ["echo", "hi"] },
      rest: Buffer.alloc(0),
    });
    expect(decodeFrame(Buffer.from([1, 0, 0, 0]))).toBeNull();
  });
});
