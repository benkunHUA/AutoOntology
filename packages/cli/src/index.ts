#!/usr/bin/env node
/**
 * ao CLI —— 第一个客户端消费者。
 *
 *   ao --mock        使用内置 Mock 模型（无需网络/密钥，验证 loop）
 *   ao              使用 OpenAI Responses API（需 OPENAI_API_KEY）
 *
 * 命令：直接输入 = 提交（忙碌时自动插话）；/abort 中断；/quit 退出。
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { MockModelClient, ResponsesClient } from "@ao/api";
import { JsonlPersistence, Session } from "@ao/core";
import type { ApprovalGate, ModelClient } from "@ao/protocol";
import { defaultTools } from "@ao/tools";
import { createRenderer } from "./render.ts";

const SYSTEM_INSTRUCTIONS = [
  "You are a coding agent working in the user's workspace.",
  "Use the provided tools to inspect and modify files, and to run commands.",
  "Work incrementally: take one step, observe the result, then continue.",
  "When the task is done, reply with a short summary of what you did.",
].join("\n");

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const useMock = args.has("--mock");
  const cwd = resolve(process.cwd());

  const client: ModelClient = useMock
    ? new MockModelClient()
    : createResponsesClient();

  const renderer = createRenderer();
  const approval: ApprovalGate = createApprovalGate(useMock);
  const skills = {
    enabled: process.env.AO_SKILLS !== "0",
    product: "codex",
  };
  const session = new Session({
    cwd,
    model: useMock ? "mock" : (process.env.AO_MODEL ?? "gpt-5-codex"),
    instructions: SYSTEM_INSTRUCTIONS,
    client,
    handlers: defaultTools(),
    approval,
    skills,
    emit: (event) => renderer.render(event),
    persistence: new JsonlPersistence(
      resolve(cwd, ".ao", "sessions", `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`),
    ),
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  process.stdout.write(
    `ao ${useMock ? "(mock)" : ""} · ${cwd}\n` +
      `输入任务开始；忙碌时输入会自动插话；/abort 中断；/quit 退出\n\n`,
  );

  let quitting = false;
  process.on("SIGINT", async () => {
    if (session.isBusy) {
      await session.abort("user");
      return;
    }
    quitting = true;
    rl.close();
  });

  for (;;) {
    const line = await rl.question(quitting ? "" : "\x1b[36m› \x1b[0m").catch(() => null);
    if (line === null || quitting) break;

    const text = line.trim();
    if (!text) continue;
    if (text === "/quit") break;

    if (text === "/abort") {
      if (!session.isBusy) process.stdout.write("（空闲中）\n");
      else await session.abort("user");
      continue;
    }

    const result = session.submit(text);
    if (result === "rejected") {
      process.stdout.write("（当前回合不可插话，请等待或 /abort）\n");
    }
  }

  await session.abort("user");
  await session.whenIdle();
  await new Promise((r) => setTimeout(r, 50)); // 等渲染器 flush
  process.stdout.write(`\n会话历史已保存到 ${cwd}/.ao/sessions/\n`);
  process.exit(0);
}

function createApprovalGate(useMock: boolean): ApprovalGate {
  const mode = process.env.AO_APPROVAL ?? (useMock ? "auto" : "deny");
  return {
    async request(request) {
      process.stderr.write(`[approval] ${request.action}\n`);
      if (request.requiresHuman) return false;
      return mode === "auto";
    },
  };
}

function createResponsesClient(): ResponsesClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "缺少 OPENAI_API_KEY。离线体验请运行：pnpm cli:mock\n",
    );
    process.exit(1);
  }
  return new ResponsesClient({
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
