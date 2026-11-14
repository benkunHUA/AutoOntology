import { describe, expect, it } from "vitest";
import { SkillCatalog } from "../src/catalog.ts";
import { selectExplicitSkills } from "../src/selection.ts";
import type { SkillCatalogEntry } from "../src/types.ts";

function entry(id: string, name: string): SkillCatalogEntry {
  return {
    id,
    authority: { kind: "host", id: "host" },
    name,
    description: name,
    mainPrompt: id,
    enabled: true,
    promptVisible: true,
  };
}

function catalog(...entries: SkillCatalogEntry[]) {
  return new SkillCatalog(entries);
}

describe("selectExplicitSkills", () => {
  it("文本 $name 唯一匹配生效", () => {
    const c = catalog(entry("skill:///a", "demo"), entry("skill:///b", "other"));
    expect(
      selectExplicitSkills([{ type: "text", text: "use $demo" }], c).map(
        (e) => e.name,
      ),
    ).toEqual(["demo"]);
  });

  it("歧义名称不生效", () => {
    const c = catalog(entry("skill:///a", "demo"), entry("skill:///b", "demo"));
    expect(
      selectExplicitSkills([{ type: "text", text: "use $demo" }], c),
    ).toEqual([]);
  });

  it("文本路径优先，结构化 skill 输入按路径选择", () => {
    const c = catalog(entry("skill:///a", "demo"));
    expect(
      selectExplicitSkills(
        [{ type: "text", text: "[$demo](skill:///a)" }],
        c,
      ).map((e) => e.id),
    ).toEqual(["skill:///a"]);
    expect(
      selectExplicitSkills([{ type: "skill", path: "skill:///a" }], c).map(
        (e) => e.id,
      ),
    ).toEqual(["skill:///a"]);
  });

  it("按 id 去重，禁用条目不参与匹配", () => {
    const c = catalog(
      entry("skill:///a", "demo"),
      { ...entry("skill:///b", "off"), enabled: false },
    );
    expect(
      selectExplicitSkills(
        [{ type: "text", text: "$demo $off $demo" }],
        c,
      ).map((e) => e.id),
    ).toEqual(["skill:///a"]);
  });
});
