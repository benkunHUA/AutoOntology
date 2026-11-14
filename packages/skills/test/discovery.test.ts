import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkills } from "../src/discovery.ts";
import { resolveSkillRoots } from "../src/roots.ts";

const SKILL = (name: string, desc = "desc") =>
  `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`;

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ao-skills-"));
  await mkdir(join(dir, "demo"), { recursive: true });
  await writeFile(join(dir, "demo", "SKILL.md"), SKILL("demo"), "utf8");
  await mkdir(join(dir, ".hidden"), { recursive: true });
  await writeFile(join(dir, ".hidden", "SKILL.md"), SKILL("hidden"), "utf8");
  return dir;
}

describe("resolveSkillRoots", () => {
  it("按发现顺序去重，首次出现保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-roots-"));
    const extra = join(dir, ".codex", "skills");
    await mkdir(extra, { recursive: true });
    const roots = resolveSkillRoots({
      cwd: dir,
      codexHome: undefined,
      home: dir,
      extraRoots: [{ path: extra, scope: "user" }],
    });
    const paths = roots.map((root) => root.path);
    expect(paths[0]).toBe(extra);
    expect(paths.filter((path) => path === extra).length).toBe(1);
  });
});

describe("discoverSkills", () => {
  it("发现 SKILL.md 并跳过隐藏目录", async () => {
    const dir = await fixture();
    const outcome = await discoverSkills({
      roots: [{ path: dir, scope: "user" }],
    });
    expect(outcome.skills.map((skill) => skill.name)).toEqual(["demo"]);
    expect(outcome.warnings).toEqual([]);
  });

  it("product 不匹配与禁用路径被过滤，非法 frontmatter 记为 warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-skills-"));
    await mkdir(join(dir, "a", "agents"), { recursive: true });
    await mkdir(join(dir, "b"), { recursive: true });
    await mkdir(join(dir, "bad"), { recursive: true });
    await writeFile(join(dir, "a", "SKILL.md"), SKILL("a"), "utf8");
    await writeFile(
      join(dir, "a", "agents", "openai.yaml"),
      "products: [work]\n",
      "utf8",
    );
    await writeFile(join(dir, "b", "SKILL.md"), SKILL("b"), "utf8");
    await writeFile(join(dir, "bad", "SKILL.md"), "no frontmatter", "utf8");

    const outcome = await discoverSkills({
      roots: [{ path: dir, scope: "user" }],
      product: "codex",
      disabledPaths: new Set([join(dir, "b", "SKILL.md")]),
    });
    expect(outcome.skills.map((skill) => skill.name)).toEqual([]);
    expect(outcome.warnings.length).toBe(1);
  });

  it("按名称禁用被过滤", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-skills-"));
    await mkdir(join(dir, "keep"), { recursive: true });
    await mkdir(join(dir, "drop"), { recursive: true });
    await writeFile(join(dir, "keep", "SKILL.md"), SKILL("keep"), "utf8");
    await writeFile(join(dir, "drop", "SKILL.md"), SKILL("drop"), "utf8");

    const outcome = await discoverSkills({
      roots: [{ path: dir, scope: "user" }],
      disabledNames: new Set(["drop"]),
    });
    expect(outcome.skills.map((skill) => skill.name)).toEqual(["keep"]);
  });

  it("按 scope、name 稳定排序", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-skills-"));
    for (const [sub, name] of [
      ["repo", "zeta"],
      ["user-beta", "beta"],
      ["user-alpha", "alpha"],
      ["system", "alpha"],
    ] as const) {
      await mkdir(join(dir, sub), { recursive: true });
      await writeFile(join(dir, sub, "SKILL.md"), SKILL(name), "utf8");
    }
    const outcome = await discoverSkills({
      roots: [
        { path: join(dir, "repo"), scope: "repo" },
        { path: join(dir, "user-beta"), scope: "user" },
        { path: join(dir, "user-alpha"), scope: "user" },
        { path: join(dir, "system"), scope: "system" },
      ],
    });
    expect(outcome.skills.map((skill) => skill.name)).toEqual([
      "zeta",
      "alpha",
      "beta",
      "alpha",
    ]);
  });
});
