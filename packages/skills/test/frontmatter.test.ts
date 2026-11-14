import { describe, expect, it } from "vitest";
import { FrontmatterError, parseFrontmatter } from "../src/frontmatter.ts";
import { MAX_SKILL_NAME_CHARS } from "../src/limits.ts";

describe("parseFrontmatter", () => {
  it("解析 name / description / short-description", () => {
    const meta = parseFrontmatter(
      "---\nname: demo\ndescription: Demo skill\nshort-description: Demo\n---\n# Body",
      "fallback",
    );
    expect(meta).toEqual({
      name: "demo",
      description: "Demo skill",
      shortDescription: "Demo",
    });
  });

  it("缺 frontmatter 抛错", () => {
    expect(() => parseFrontmatter("# no frontmatter")).toThrow(FrontmatterError);
  });

  it("缺 name 时使用目录名，目录名也缺则抛错", () => {
    expect(() => parseFrontmatter("---\ndescription: d\n---\n", "")).toThrow(
      FrontmatterError,
    );
    expect(parseFrontmatter("---\ndescription: d\n---\n", "from-dir").name).toBe(
      "from-dir",
    );
  });

  it("name 截断到 64 字符", () => {
    const meta = parseFrontmatter(
      `---\nname: ${"x".repeat(80)}\ndescription: d\n---\n`,
    );
    expect(meta.name.length).toBe(MAX_SKILL_NAME_CHARS);
  });
});
