/**
 * 命令分发：解析输入 → 查表 → 可用性校验 → 交给执行层。
 */
import type {
  SlashCommandContext,
  SlashCommandParseResult,
  SlashCommandResult,
} from "./types.ts";
import { executeSlashCommand } from "./execution.ts";
import type { SlashCommandRegistry } from "./registry.ts";

export function parseSlashCommand(input: string): SlashCommandParseResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/") || trimmed === "/") return null;
  const match = trimmed.slice(1).match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1], args: match[2] ?? "" };
}

export class SlashCommandDispatcher {
  constructor(private readonly registry: SlashCommandRegistry) {}

  async dispatch(
    input: string,
    context: SlashCommandContext,
  ): Promise<SlashCommandResult> {
    const parsed = parseSlashCommand(input);
    if (!parsed) {
      return { ok: false, output: "不是斜杠命令" };
    }

    const command = this.registry.find(parsed.name);
    if (!command) {
      return { ok: false, output: `未知斜杠命令：/${parsed.name}` };
    }
    if (parsed.args.trim() !== "" && command.supportsInlineArgs !== true) {
      return { ok: false, output: `/${command.name} 不支持参数` };
    }
    const thread = context.host.get(context.threadId);
    if (thread?.isBusy && command.availableDuringTask !== true) {
      return {
        ok: false,
        output: `/${command.name} 在任务进行中不可用`,
      };
    }

    return executeSlashCommand(command, context, parsed.args);
  }
}
