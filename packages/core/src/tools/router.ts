/**
 * 工具路由：每次采样编译出的不可变工具快照。
 *
 * 注册期（ToolRegistry）与应用期（resolve / modelVisibleSpecs）分离：
 * 本实例只读，不修改花名册；可见性校验与分发来自同一份快照。
 */
import type {
  FunctionCallItem,
  ToolHandler,
  ToolSchemaNode,
} from "@ao/protocol";
import type { ToolPolicy } from "./registry.ts";
import {
  ToolRegistry,
  toolNameKey,
  trustedRegistry,
  type RegisteredTool,
} from "./registry.ts";

export interface ResolvedToolCall {
  call: FunctionCallItem;
  handler?: ToolHandler;
  args: Record<string, unknown>;
  /** 参数解析失败时的失败结果（跳过执行，直接回填）。 */
  failure?: { ok: boolean; output: string };
}

export class ToolRouter {
  private readonly tools: ReadonlyMap<string, RegisteredTool>;
  private readonly firstCollision: string | null;

  constructor(handlers: readonly ToolHandler[], policy?: ToolPolicy);
  constructor(registry: ToolRegistry);
  constructor(source: readonly ToolHandler[] | ToolRegistry, policy?: ToolPolicy) {
    const registry =
      source instanceof ToolRegistry ? source : trustedRegistry(source, policy);
    this.tools = new Map(
      registry
        .entries()
        .map((entry) => [
          toolNameKey(entry.handler.spec.name, entry.handler.spec.namespace),
          entry,
        ]),
    );
    this.firstCollision = registry.collision();
  }

  modelVisibleSpecs(): ToolSchemaNode[] {
    return [...this.tools.values()]
      .filter((entry) => entry.exposure === "direct")
      .map((entry) => ({
        name: entry.handler.spec.name,
        description: entry.handler.spec.description,
        parameters: entry.handler.spec.parameters,
      }));
  }

  supportsParallel(name: string): boolean {
    return this.tools.get(toolNameKey(name))?.handler.spec.supportsParallel === true;
  }

  registeredTool(name: string): ToolHandler | undefined {
    return this.tools.get(toolNameKey(name))?.handler;
  }

  collision(): string | null {
    return this.firstCollision;
  }

  resolve(call: FunctionCallItem): ResolvedToolCall {
    const handler = this.registeredTool(call.name);
    if (!handler) {
      return {
        call,
        args: {},
        failure: { ok: false, output: `unknown tool: ${call.name}` },
      };
    }
    try {
      const args = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("arguments must be a JSON object");
      }
      return { call, handler, args };
    } catch (error) {
      return {
        call,
        handler,
        args: {},
        failure: {
          ok: false,
          output: `invalid tool arguments for ${call.name}: ${(error as Error).message}`,
        },
      };
    }
  }
}
