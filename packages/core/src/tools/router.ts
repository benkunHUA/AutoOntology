/**
 * 工具路由（对应 ToolRouter）：持有工具表，构建下发给模型的 schema，
 * 把 function_call 解析到具体执行器。每次采样生成一个实例（不可变快照）。
 */
import type {
  FunctionCallItem,
  ToolHandler,
  ToolSchemaNode,
  ToolSpec,
} from "@ao/protocol";

export interface ResolvedToolCall {
  call: FunctionCallItem;
  handler: ToolHandler;
  args: Record<string, unknown>;
  /** 参数解析失败时的失败结果（跳过执行，直接回填）。 */
  failure?: { ok: boolean; output: string };
}

export class ToolRouter {
  private readonly handlers = new Map<string, ToolHandler>();

  constructor(handlers: ToolHandler[]) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.spec.name)) {
        throw new Error(`duplicate tool: ${handler.spec.name}`);
      }
      this.handlers.set(handler.spec.name, handler);
    }
  }

  modelVisibleSpecs(): ToolSchemaNode[] {
    return [...this.handlers.values()].map((h) => ({
      name: h.spec.name,
      description: h.spec.description,
      parameters: h.spec.parameters,
    }));
  }

  spec(name: string): ToolSpec | undefined {
    return this.handlers.get(name)?.spec;
  }

  supportsParallel(name: string): boolean {
    return this.handlers.get(name)?.spec.supportsParallel === true;
  }

  resolve(call: FunctionCallItem): ResolvedToolCall {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return {
        call,
        handler: missingHandler,
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

const missingHandler: ToolHandler = {
  spec: { name: "<missing>", description: "", parameters: {} },
  async execute() {
    return { ok: false, output: "unknown tool" };
  },
};
