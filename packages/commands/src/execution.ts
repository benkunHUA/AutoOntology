/**
 * 命令执行：统一捕获 handler 异常并转成结构化失败结果。
 */
import type {
  SlashCommandResult,
  SlashCommandSpec,
} from "./types.ts";

export async function executeSlashCommand(
  command: SlashCommandSpec,
  context: Parameters<SlashCommandSpec["execute"]>[0],
  args: string,
): Promise<SlashCommandResult> {
  try {
    return await command.execute(context, args);
  } catch (error) {
    return {
      ok: false,
      output: `命令 ${command.name} 执行失败：${(error as Error).message}`,
    };
  }
}
