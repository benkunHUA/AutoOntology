/**
 * 命令声明：内置斜杠命令的单一事实来源。
 *
 * 只描述命令自身的元数据与执行逻辑；发现、分发与执行由上层模块驱动。
 */
import type { SlashCommandSpec } from "./types.ts";

export const quitCommand: SlashCommandSpec = {
  name: "quit",
  description: "退出",
  availableDuringTask: true,
  async execute() {
    return { ok: true, output: "已退出。", exit: true };
  },
};

export const abortCommand: SlashCommandSpec = {
  name: "abort",
  description: "中断当前回合",
  availableDuringTask: true,
  async execute(context) {
    const thread = context.host.get(context.threadId);
    if (!thread) {
      return { ok: false, output: "当前线程不存在。" };
    }
    if (!thread.isBusy) {
      return { ok: true, output: "（空闲中）" };
    }
    await thread.abort("user");
    return { ok: true, output: "已中断当前回合。" };
  },
};

export const newThreadCommand: SlashCommandSpec = {
  name: "new",
  description: "新建会话",
  async execute(context) {
    context.host.createRootLike();
    return { ok: true, output: "已新建会话。" };
  },
};

export const compactCommand: SlashCommandSpec = {
  name: "compact",
  aliases: ["compress"],
  description: "压缩对话上下文，避免达到上下文上限",
  async execute(context) {
    const thread = context.host.get(context.threadId);
    if (!thread) {
      return { ok: false, output: "当前线程不存在。" };
    }
    const outcome = await thread.compact();
    return outcome.compacted
      ? { ok: true, output: "上下文已压缩。" }
      : { ok: false, output: "压缩未生成摘要。" };
  },
};

export function builtInSlashCommands(): SlashCommandSpec[] {
  return [quitCommand, abortCommand, newThreadCommand, compactCommand];
}
