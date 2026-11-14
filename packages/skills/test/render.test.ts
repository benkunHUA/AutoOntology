import { describe, expect, it } from "vitest";
import { SkillCatalog } from "../src/catalog.ts";
import { renderAvailableSkills } from "../src/render.ts";
import type { SkillCatalogEntry } from "../src/types.ts";

function entry(
  name: string,
  description = `${name} description`,
): SkillCatalogEntry {
  return {
    id: `skill:///${name}`,
    authority: { kind: "host", id: "host" },
    name,
    description,
    shortDescription: description,
    mainPrompt: `skill:///${name}`,
    enabled: true,
    promptVisible: true,
  };
}

describe("renderAvailableSkills", () => {
  it("预算内输出名称与描述", () => {
    const out = renderAvailableSkills(new SkillCatalog([entry("demo")]));
    expect(out).toContain("## Skills");
    expect(out).toContain("- demo: demo description");
  });

  it("omitDescriptions 省略描述", () => {
    const out = renderAvailableSkills(new SkillCatalog([entry("demo")]), {
      omitDescriptions: true,
    });
    expect(out).toContain("- demo");
    expect(out).not.toContain("description");
  });

  it("预算不足先退化为仅名称", () => {
    const c = new SkillCatalog(
      ["a", "b", "c"].map((n) => entry(n, "x".repeat(100))),
    );
    const out = renderAvailableSkills(c, { budgetChars: 60 });
    expect(out).toContain("- a");
    expect(out).not.toContain("x".repeat(100));
  });

  it("极端预算截断并提示省略数量", () => {
    const c = new SkillCatalog(
      Array.from({ length: 30 }, (_, i) => entry(`skill-${i}`)),
    );
    const out = renderAvailableSkills(c, { budgetChars: 80 });
    expect(out).toMatch(/additional skills omitted/);
  });

  it("单条描述截断到 1024 字符", () => {
    const long = "y".repeat(2000);
    const out = renderAvailableSkills(new SkillCatalog([entry("demo", long)]));
    expect(out).toContain("y".repeat(1024));
    expect(out).not.toContain("y".repeat(1025));
  });
});
