import { describe, expect, it } from "vitest";
import type { ToolHandler } from "@ao/protocol";
import {
  ToolCollisionError,
  ToolRegistry,
  trustedRegistry,
} from "../src/tools/registry.ts";

function handler(name: string, overrides: Partial<ToolHandler["spec"]> = {}): ToolHandler {
  return {
    spec: { name, description: name, parameters: {}, ...overrides },
    async execute() {
      return { ok: true, output: name };
    },
  };
}

describe("ToolRegistry", () => {
  it("可信撞名是缺陷", () => {
    const registry = new ToolRegistry();
    registry.registerTrusted(handler("read_file"));
    expect(() => registry.registerTrusted(handler("read_file"))).toThrow(
      ToolCollisionError,
    );
  });

  it("外部撞名与保留名被跳过并记录", () => {
    const registry = new ToolRegistry();
    expect(registry.registerExternal(handler("exec_command"))).toBe(false);
    expect(registry.collision()).toBe("exec_command");

    registry.registerTrusted(handler("plugin_tool"));
    expect(registry.registerExternal(handler("plugin_tool"))).toBe(false);
    expect(registry.has("plugin_tool")).toBe(true);
  });

  it("策略在注册期过滤，被拒工具不进映射表", () => {
    const registry = trustedRegistry(
      [handler("allow"), handler("deny")],
      { allows: (name) => name !== "deny" },
    );
    expect(registry.has("allow")).toBe(true);
    expect(registry.has("deny")).toBe(false);
    expect(registry.entries().map((e) => e.handler.spec.name)).toEqual(["allow"]);
  });

  it("键按默认命名空间规范化，保留名只保护默认命名空间", () => {
    const registry = new ToolRegistry();
    expect(
      registry.registerExternal(
        handler("exec_command", { namespace: "functions" }),
      ),
    ).toBe(false);
    expect(
      registry.registerExternal(handler("exec_command", { namespace: "custom" })),
    ).toBe(true);
    expect(registry.has("exec_command")).toBe(false);
    expect(registry.entries().map((e) => e.handler.spec.name)).toEqual([
      "exec_command",
    ]);
  });
});
