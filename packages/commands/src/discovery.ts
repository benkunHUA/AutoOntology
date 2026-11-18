/**
 * 命令发现：把声明集编译成可供分发使用的注册表。
 */
import type { SlashCommandSpec } from "./types.ts";
import { builtInSlashCommands } from "./declaration.ts";
import { SlashCommandRegistry } from "./registry.ts";

export function discoverSlashCommands(
  declarations: readonly SlashCommandSpec[] = builtInSlashCommands(),
): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();
  for (const declaration of declarations) registry.register(declaration);
  return registry;
}
