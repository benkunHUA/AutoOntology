import { describe, expect, it } from "vitest";
import { SkillCatalog } from "../src/catalog.ts";
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
  it("按 (authority, id) 去重，extend 保留警告", () => {
    const a = new SkillCatalog([entry("x", "x")], ["w1"], false);
    const b = new SkillCatalog(
      [entry("x", "x"), entry("y", "y")],
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
