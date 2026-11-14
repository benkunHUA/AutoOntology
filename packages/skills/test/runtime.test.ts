import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_PROMPT_BYTES } from "../src/limits.ts";
import { SkillRuntime } from "../src/runtime.ts";

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ao-rt-"));
  await mkdir(join(dir, "demo"), { recursive: true });
  await writeFile(
    join(dir, "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Demo skill\n---\n# Body\n\nHello from demo",
    "utf8",
  );
  return dir;
}

describe("SkillRuntime", () => {
  it("prepareStep 发现 host 技能并渲染目录", async () => {
    const root = await makeRoot();
    const runtime = new SkillRuntime({
      rootResolver: () => [{ path: root, scope: "user" }],
    });
    const step = await runtime.prepareStep({ cwd: root });
    expect(step.catalog.entries.map((entry) => entry.name)).toEqual(["demo"]);
    expect(runtime.renderCatalog(step)).toContain("- demo: Demo skill");
  });

  it("collectSkillFragments 按 $name 读取并截断正文到 8000 字节", async () => {
    const root = await makeRoot();
    const runtime = new SkillRuntime({
      rootResolver: () => [{ path: root, scope: "user" }],
    });
    const step = await runtime.prepareStep({ cwd: root });
    const fragments = await runtime.collectSkillFragments(
      [{ type: "text", text: "use $demo" }],
      step,
    );
    expect(fragments.length).toBe(1);
    expect(fragments[0].name).toBe("demo");
    expect(fragments[0].content).toContain("Hello from demo");

    const big = "z".repeat(MAIN_PROMPT_BYTES + 100);
    await writeFile(
      join(root, "demo", "SKILL.md"),
      `---\nname: demo\ndescription: d\n---\n${big}`,
      "utf8",
    );
    const step2 = await runtime.prepareStep({ cwd: root });
    const [fragment] = await runtime.collectSkillFragments(
      [{ type: "text", text: "$demo" }],
      step2,
    );
    expect(Buffer.byteLength(fragment.content, "utf8")).toBeLessThanOrEqual(
      MAIN_PROMPT_BYTES,
    );
  });

  it("无 provider 或未命中时返回空片段", async () => {
    const root = await makeRoot();
    const runtime = new SkillRuntime({
      rootResolver: () => [{ path: root, scope: "user" }],
    });
    const step = await runtime.prepareStep({ cwd: root });
    expect(
      await runtime.collectSkillFragments(
        [{ type: "text", text: "no mention" }],
        step,
      ),
    ).toEqual([]);
  });
});
