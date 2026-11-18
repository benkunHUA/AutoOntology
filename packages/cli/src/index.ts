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
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { MockModelClient, ResponsesClient } from "@ao/api";
import {
  SlashCommandDispatcher,
  discoverSlashCommands,
  parseSlashCommand,
  type SlashCommandContext,
} from "@ao/commands";
import {
  ThreadManager,
  type ThreadOptions,
} from "@ao/core";
import type { ApprovalGate, ModelClient } from "@ao/protocol";
import { defaultTools } from "@ao/tools";
import { createRenderer } from "./render.ts";
import {
  loadConfigFile,
  resolveConfig,
  resolveSandboxProfile,
  type AppConfig,
} from "./config.ts";

const SYSTEM_INSTRUCTIONS = [
  "You are a coding agent working in the user's workspace.",
  "Use the provided tools to inspect and modify files, and to run commands.",
  "Work incrementally: take one step, observe the result, then continue.",
  "If a command fails, do not retry the same command more than once; read the error and switch to a simpler or platform-compatible approach.",
  "On macOS, avoid `timeout`; prefer Node/Python checks and the project's own typecheck/tests before launching GUI browsers or installing packages.",
  "When the task is done, reply with a short summary of what you did.",
].join("\n");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useMock = argv.includes("--mock");
  const configArgIndex = argv.indexOf("--config");
  const configPath =
    configArgIndex >= 0 ? argv[configArgIndex + 1] : undefined;
  const cwd = resolve(process.cwd());
  const config = resolveConfig(await loadConfigFile(cwd, configPath));

  const client: ModelClient = useMock
    ? new MockModelClient()
    : createResponsesClient(config);

  const renderer = createRenderer();
  const approval: ApprovalGate = createApprovalGate(
    useMock,
    config.approval ?? "auto",
  );
  const skills = {
    enabled: config.skills,
  };
  const threadOptions: ThreadOptions = {
    cwd,
    model: useMock ? "mock" : config.modelName,
    instructions: SYSTEM_INSTRUCTIONS,
    client,
    handlers: defaultTools(),
    approval,
    skills,
    permissionProfile: resolveSandboxProfile(cwd, config),
    emit: (event) => renderer.render(event),
    persistenceDir: resolve(cwd, ".ao", "sessions"),
  };
  const threads = new ThreadManager();
  threads.createRoot(threadOptions);
  const currentThread = () => threads.current()!;
  const commandDispatcher = new SlashCommandDispatcher(discoverSlashCommands());
  const commandContext: SlashCommandContext = {
    get threadId() {
      return currentThread().threadId;
    },
    host: {
      get: (threadId) => threads.get(threadId),
      createRootLike: () => {
        threads.createRootLike();
      },
    },
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  process.stdout.write(
    `ao ${useMock ? "(mock)" : ""} · ${cwd}\n` +
      `输入任务开始；忙碌时输入会自动插话；/abort 中断；/new 新建会话；/compact 压缩上下文；/quit 退出\n\n`,
  );

  let quitting = false;
  process.on("SIGINT", async () => {
    const thread = currentThread();
    if (thread.isBusy) {
      await thread.abort("user");
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

    if (parseSlashCommand(text) !== null) {
      const commandResult = await commandDispatcher.dispatch(text, commandContext);
      writeLine(
        commandResult.ok
          ? commandResult.output
          : `（${commandResult.output}）`,
      );
      if (commandResult.exit) break;
      continue;
    }

    const result = await currentThread().submit(text);
    if (result === "rejected") {
      process.stdout.write("（当前回合不可插话，请等待或 /abort）\n");
    }
  }

  const thread = currentThread();
  await thread.abort("user");
  await thread.whenIdle();
  await new Promise((r) => setTimeout(r, 50)); // 等渲染器 flush
  writeLine(`\n会话历史已保存到 ${cwd}/.ao/sessions/${thread.sessionId}/${thread.threadId}.jsonl`);
  process.exit(0);
}

function writeLine(text: string): void {
  writeSync(process.stdout.fd, `${text}\n`);
}

function createApprovalGate(_useMock: boolean, mode: "auto" | "deny"): ApprovalGate {
  return {
    async request(request) {
      process.stderr.write(`[approval] ${request.action}\n`);
      if (request.requiresHuman) return "denied";
      return mode === "auto" ? "approved" : "denied";
    },
  };
}

function createResponsesClient(config: AppConfig): ResponsesClient {
  if (!config.apiKey) {
    process.stderr.write(
      "缺少 api_key。请在 ao.config.json 中设置，或设置 OPENAI_API_KEY；离线体验请运行：pnpm cli:mock\n",
    );
    process.exit(1);
  }
  return new ResponsesClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
