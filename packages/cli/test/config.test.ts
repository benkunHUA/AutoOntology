import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFile, resolveConfig } from "../src/config.ts";

describe("config", () => {
  it("读取默认 ao.config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-config-"));
    await writeFile(
      join(dir, "ao.config.json"),
      JSON.stringify({
        api_key: "sk-file",
        model_name: "gpt-5-codex",
        base_url: "https://example.test/v1",
        approval: "auto",
        skills: false,
      }),
      "utf8",
    );

    const file = await loadConfigFile(dir);
    expect(resolveConfig(file)).toEqual({
      apiKey: "sk-file",
      modelName: "gpt-5-codex",
      baseUrl: "https://example.test/v1",
      approval: "auto",
      skills: false,
    });
  });

  it("approval 与 skills 可省略并使用默认值", async () => {
    expect(
      resolveConfig({
        api_key: "sk-file",
        model_name: "gpt-5-codex",
        base_url: "https://example.test/v1",
      }),
    ).toEqual({
      apiKey: "sk-file",
      modelName: "gpt-5-codex",
      baseUrl: "https://example.test/v1",
      approval: undefined,
      skills: true,
    });
  });

  it("文件不存在时回退默认值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-config-empty-"));
    expect(resolveConfig(await loadConfigFile(dir))).toEqual({
      apiKey: "",
      modelName: "deepseek-flash",
      baseUrl: "https://api.openai.com/v1",
      approval: undefined,
      skills: true,
    });
  });
});
