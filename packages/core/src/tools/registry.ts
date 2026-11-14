/**
 * 工具花名册：名字 → 登记条目的保序映射表。
 *
 * 注册 ≠ 可见 ≠ 可用。注册期应用 ToolPolicy 与保留名保护；
 * 路由编译期再决定哪些工具进入模型说明书。
 */
import type { ToolExposure, ToolHandler } from "@ao/protocol";

export interface ToolPolicy {
  allows(name: string): boolean;
}

export interface RegisteredTool {
  readonly handler: ToolHandler;
  readonly exposure: ToolExposure;
}

const DEFAULT_NAMESPACE = "functions";

/**
 * 注册键：结构化工具名的内部编码。NUL 不会出现在工具名里，
 * 因此不会像「无分隔符拼接」那样产生 a+bc 与 ab+c 的歧义。
 */
export function toolNameKey(name: string, namespace?: string): string {
  const normalized = namespace === undefined || namespace === "" ? DEFAULT_NAMESPACE : namespace;
  return `${normalized}\u0000${name}`;
}

function isDefaultNamespace(namespace: string | undefined): boolean {
  return namespace === undefined || namespace === "" || namespace === DEFAULT_NAMESPACE;
}

function isDebugBuild(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** 默认命名空间下禁止外部注册的内置名。 */
export const RESERVED_EXTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "exec_command",
  "shell_command",
]);

export class ToolCollisionError extends Error {
  constructor(name: string) {
    super(`duplicate trusted tool: ${name}`);
    this.name = "ToolCollisionError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private firstCollision: string | null = null;

  constructor(private readonly policy?: ToolPolicy) {}

  /** 可信通道：撞名视为缺陷，直接抛出（由启动自检/测试兜住）。 */
  registerTrusted(handler: ToolHandler): void {
    this.register(handler, "trusted");
  }

  /** 外部通道：撞名或命中保留名时跳过，返回 false。 */
  registerExternal(handler: ToolHandler): boolean {
    return this.register(handler, "external");
  }

  registeredTool(name: string): RegisteredTool | undefined {
    return this.tools.get(toolNameKey(name));
  }

  has(name: string): boolean {
    return this.tools.has(toolNameKey(name));
  }

  /** 保序迭代，顺序进入模型说明书。 */
  entries(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  supportsParallel(name: string): boolean {
    return (
      this.tools.get(toolNameKey(name))?.handler.spec.supportsParallel === true
    );
  }

  /** 首个被跳过/拒绝的冲突名，观测用。 */
  collision(): string | null {
    return this.firstCollision;
  }

  private register(
    handler: ToolHandler,
    channel: "trusted" | "external",
  ): boolean {
    const name = handler.spec.name;

    if (
      channel === "external" &&
      isDefaultNamespace(handler.spec.namespace) &&
      RESERVED_EXTERNAL_TOOL_NAMES.has(name)
    ) {
      this.firstCollision ??= name;
      return false;
    }

    // 策略在注册期拒绝，被拒工具根本不进映射表。
    if (this.policy && !this.policy.allows(name)) return false;

    const key = toolNameKey(name, handler.spec.namespace);
    if (this.tools.has(key)) {
      if (channel === "trusted") {
        if (isDebugBuild()) throw new ToolCollisionError(name);
        console.error(`[tool-registry] duplicate trusted tool: ${name}`);
        this.firstCollision ??= name;
        return false;
      }
      this.firstCollision ??= name;
      return false;
    }

    this.tools.set(key, {
      handler,
      exposure: handler.spec.exposure ?? "direct",
    });
    return true;
  }
}

/** 从可信工具列表构造花名册；重复名按缺陷处理。 */
export function trustedRegistry(
  handlers: readonly ToolHandler[],
  policy?: ToolPolicy,
): ToolRegistry {
  const registry = new ToolRegistry(policy);
  for (const handler of handlers) registry.registerTrusted(handler);
  return registry;
}
