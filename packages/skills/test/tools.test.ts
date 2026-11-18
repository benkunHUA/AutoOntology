import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@ao/protocol";
import { SkillRuntime } from "../src/runtime.ts";
import { createSkillTools } from "../src/tools.ts";

function ctx(): ToolContext {
  return {
    cwd: "/tmp",
    signal: new AbortController().signal,
    toolName: "",
    callId: "",
    orchestrator: undefined as never,
  };
}

async function runtimeWith(count: number): Promise<SkillRuntime> {
  const dir = await mkdtemp(join(tmpdir(), "ao-tools-"));
  for (let i = 0; i < count; i++) {
    await mkdir(join(dir, `s${i}`), { recursive: true });
    await writeFile(
      join(dir, `s${i}`, "SKILL.md"),
      `---\nname: s${i}\ndescription: d${i}\n---\n# body ${i}\n`,
      "utf8",
    );
  }
  return new SkillRuntime({
    rootResolver: () => [{ path: dir, scope: "user" }],
  });
}

describe("createSkillTools", () => {
  it("skills_list 分页且 nextCursor 正确", async () => {
    const runtime = await runtimeWith(25);
    await runtime.prepareStep({ cwd: "/tmp" });
    const tools = createSkillTools(runtime);
    const list = tools.find((tool) => tool.spec.name === "skills_list")!;
    const result = await list.execute({}, ctx());
    expect(result.ok).toBe(true);
    const page = JSON.parse(result.output);
    expect(page.skills.length).toBe(20);
    expect(page.nextCursor).toBe("20");
  });

  it("skills_read 读取主 prompt 并分页", async () => {
    const runtime = await runtimeWith(1);
    await runtime.prepareStep({ cwd: "/tmp" });
    const tools = createSkillTools(runtime);
    const read = tools.find((tool) => tool.spec.name === "skills_read")!;

    const missing = await read.execute({ package: "skill://" }, ctx());
    expect(missing.ok).toBe(false);

    const entry = runtime.currentStep!.catalog.entries[0];
    const okResult = await read.execute({ package: entry.id }, ctx());
    expect(okResult.ok).toBe(true);
    expect(JSON.parse(okResult.output).contents).toContain("# body 0");
  });

  it("skills_read 拒绝读取技能目录之外的文件", async () => {
    const runtime = await runtimeWith(1);
    await runtime.prepareStep({ cwd: "/tmp" });
    const tools = createSkillTools(runtime);
    const read = tools.find((tool) => tool.spec.name === "skills_read")!;
    const entry = runtime.currentStep!.catalog.entries[0];

    const secret = join(await mkdtemp(join(tmpdir(), "ao-outside-")), "secret.txt");
    await writeFile(secret, "outside secret", "utf8");

    const result = await read.execute(
      { package: entry.id, resource: secret },
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("escapes");
  });

  it("未准备时返回错误", async () => {
    const runtime = await runtimeWith(0);
    const tools = createSkillTools(runtime);
    const list = tools.find((tool) => tool.spec.name === "skills_list")!;
    const result = await list.execute({}, ctx());
    expect(result.ok).toBe(false);
  });
});
