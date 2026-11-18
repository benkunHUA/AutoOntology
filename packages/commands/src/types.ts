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

/**
 * 命令宿主：commands 只依赖这个最小接口，宿主（CLI/TUI）负责把
 * 自己的线程管理实现适配进来，避免命令层反向依赖 core。
 */
export interface CommandThread {
  readonly isBusy: boolean;
  abort(reason?: "user"): Promise<void>;
  compact(): Promise<{ compacted: boolean; summary?: string }>;
}

export interface CommandHost {
  get(threadId: string): CommandThread | undefined;
  createRootLike(): void;
}

export interface SlashCommandContext {
  readonly threadId: string;
  readonly host: CommandHost;
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
