import { describe, expect, it } from "vitest";
import { parseAgentPolicy } from "../src/policy.ts";

describe("parseAgentPolicy", () => {
  it("解析 allow-implicit-invocation: false 与 products 列表", () => {
    const policy = parseAgentPolicy(
      "allow-implicit-invocation: false\nproducts: [codex, work]\n",
    );
    expect(policy).toEqual({
      allowImplicitInvocation: false,
      products: ["codex", "work"],
    });
  });

  it("默认允许隐式调用且无产品限制", () => {
    expect(parseAgentPolicy("")).toEqual({
      allowImplicitInvocation: true,
      products: [],
    });
  });
});
