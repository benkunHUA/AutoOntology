import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  HistoryItem,
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";
import { Session } from "../src/session.ts";

function captureClient(captured: {
  input?: HistoryItem[];
  tools?: string[];
}): ModelClient {
  return {
    id: "capture",
    async *stream(
      request: ModelRequest,
      _options: StreamOptions,
    ): AsyncGenerator<ResponseEvent> {
      captured.input = request.input;
      captured.tools = request.tools.map((tool) => tool.name);
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: { type: "message", role: "assistant", text: "done" },
      };
      yield {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

async function makeSkillsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ao-core-skills-"));
  await mkdir(join(dir, "demo"), { recursive: true });
  await writeFile(
    join(dir, "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Demo skill\n---\n# Demo body",
    "utf8",
  );
  return dir;
}

describe("技能注入", () => {
  it("注入可用目录与 $name 正文，并注册技能工具", async () => {
    const root = await makeSkillsDir();
    const captured: { input?: HistoryItem[]; tools?: string[] } = {};
    const session = new Session({
      cwd: root,
      model: "test",
      instructions: "",
      client: captureClient(captured),
      handlers: [],
      emit: () => {},
      skills: { roots: [{ path: root, scope: "user" }] },
    });
    session.submit("use $demo now");
    await session.whenIdle();

    const developer = captured.input?.filter(
      (item) => item.type === "message" && item.role === "developer",
    );
    expect(
      developer?.some(
        (item) =>
          item.type === "message" && item.text.includes("Available skills"),
      ),
    ).toBe(true);
    expect(
      captured.input?.some(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.text.includes("Demo body"),
      ),
    ).toBe(true);
    expect(captured.tools).toContain("skills.list");
    expect(captured.tools).toContain("skills.read");
  });

  it("禁用技能时不注入目录、不注册工具", async () => {
    const root = await makeSkillsDir();
    const captured: { input?: HistoryItem[]; tools?: string[] } = {};
    const session = new Session({
      cwd: root,
      model: "test",
      instructions: "",
      client: captureClient(captured),
      handlers: [],
      emit: () => {},
      skills: { enabled: false, roots: [{ path: root, scope: "user" }] },
    });
    session.submit("use $demo now");
    await session.whenIdle();

    expect(
      captured.input?.some(
        (item) =>
          item.type === "message" && item.text.includes("Available skills"),
      ),
    ).toBe(false);
    expect(captured.tools).not.toContain("skills.list");
  });
});
