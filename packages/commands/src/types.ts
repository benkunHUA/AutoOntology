/**
 * 斜杠命令契约。
 *
 * 声明只描述「是什么」，不关心命令从哪来或由谁执行；
 * 执行上下文由宿主（CLI/TUI）注入，避免命令包反向依赖 core。
 */

export interface SlashCommandParseResult {
  name: string;
  args: string;
}

export interface SlashCommandResult {
  ok: boolean;
  output: string;
  exit?: boolean;
}

import type { ThreadManager } from "@ao/core";

export interface SlashCommandContext {
  readonly threadId: string;
  readonly threadManager: ThreadManager;
}

export type SlashCommandExecutor = (
  context: SlashCommandContext,
  args: string,
) => Promise<SlashCommandResult>;

export interface SlashCommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly supportsInlineArgs?: boolean;
  readonly availableDuringTask?: boolean;
  readonly execute: SlashCommandExecutor;
}
