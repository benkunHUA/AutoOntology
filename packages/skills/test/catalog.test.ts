import { describe, expect, it } from "vitest";
import { SkillCatalog, mergeCatalogs } from "../src/catalog.ts";
import type { SkillCatalogEntry } from "../src/types.ts";

function entry(
  id: string,
  name: string,
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry {
  return {
    id,
    authority: { kind: "host", id: "host" },
    name,
    description: name,
    mainPrompt: id,
    enabled: true,
    promptVisible: true,
    ...overrides,
  };
}

describe("SkillCatalog", () => {
  it("按 (authority, id, environmentId) 去重，extend 保留警告", () => {
    const a = new SkillCatalog([entry("x", "x")], ["w1"], false);
    const b = new SkillCatalog(
      [entry("x", "x"), entry("y", "y", { environmentId: "env1" })],
      ["w2"],
      true,
    );
    a.extend(b);
    expect(a.entries.map((e) => e.id)).toEqual(["x", "y"]);
    expect(a.warnings).toEqual(["w1", "w2"]);
  });

  it("visible 只返回 enabled 且 promptVisible", () => {
    const catalog = new SkillCatalog([
      entry("a", "a"),
      entry("b", "b", { enabled: false }),
      entry("c", "c", { promptVisible: false }),
    ]);
    expect(catalog.visible().map((e) => e.id)).toEqual(["a"]);
  });
});

describe("mergeCatalogs", () => {
  it("无 cloud 时直接返回 executor", () => {
    const executor = new SkillCatalog([
      entry("e1", "e1", { authority: { kind: "executor", id: "env" } }),
    ]);
    expect(mergeCatalogs(null, executor)).toBe(executor);
  });

  it("cloud 完整且匹配：合并为 cloud 条目的 sources", () => {
    const cloud = new SkillCatalog(
      [
        entry("c1", "demo", {
          authority: { kind: "cloud", id: "cloud" },
          remotePluginId: "p",
        }),
      ],
      [],
      false,
    );
    const executor = new SkillCatalog([
      entry("e1", "demo", {
        authority: { kind: "executor", id: "env" },
        remotePluginId: "p",
      }),
    ]);
    const merged = mergeCatalogs(cloud, executor);
    expect(merged.entries.length).toBe(1);
    expect(merged.entries[0].sources?.length).toBe(1);
    expect(merged.entries[0].sources?.[0].authority.kind).toBe("executor");
    expect(cloud.entries[0].sources).toBeUndefined();
  });

  it("cloud 完整且不匹配：禁用 executor 条目", () => {
    const cloud = new SkillCatalog(
      [entry("c1", "demo", { authority: { kind: "cloud", id: "cloud" } })],
      [],
      false,
    );
    const executor = new SkillCatalog([
      entry("e1", "other", { authority: { kind: "executor", id: "env" } }),
    ]);
    expect(mergeCatalogs(cloud, executor).entries.map((e) => e.name)).toEqual([
      "demo",
    ]);
  });

  it("cloud 部分且不匹配：保留 executor 条目", () => {
    const cloud = new SkillCatalog(
      [entry("c1", "demo", { authority: { kind: "cloud", id: "cloud" } })],
      [],
      true,
    );
    const executor = new SkillCatalog([
      entry("e1", "other", { authority: { kind: "executor", id: "env" } }),
    ]);
    expect(mergeCatalogs(cloud, executor).entries.map((e) => e.name)).toEqual([
      "demo",
      "other",
    ]);
  });
});
