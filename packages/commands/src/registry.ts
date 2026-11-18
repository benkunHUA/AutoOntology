/**
 * 命令注册表：命令名/别名到声明的保序映射。
 *
 * 撞名属于内置命令缺陷，因此直接抛出，由启动自检/测试兜住。
 */
import type { SlashCommandSpec } from "./types.ts";

export class SlashCommandRegistry {
  private readonly commands = new Map<string, SlashCommandSpec>();
  private readonly aliasToName = new Map<string, string>();

  register(spec: SlashCommandSpec): void {
    this.assertAvailable(spec.name);
    this.commands.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) {
      this.assertAvailable(alias);
      this.aliasToName.set(alias, spec.name);
    }
  }

  find(name: string): SlashCommandSpec | undefined {
    const canonical = this.aliasToName.get(name) ?? name;
    return this.commands.get(canonical);
  }

  list(): SlashCommandSpec[] {
    return [...this.commands.values()];
  }

  private assertAvailable(name: string): void {
    if (this.commands.has(name) || this.aliasToName.has(name)) {
      throw new Error(`斜杠命令重复：${name}`);
    }
  }
}
