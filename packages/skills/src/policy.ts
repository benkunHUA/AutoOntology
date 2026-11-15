/**
 * agents/openai.yaml 策略解析器。
 *
 * 提取 allow-implicit-invocation 与 products 限制；
 * 文件缺失或解析失败时回退到 DEFAULT_POLICY。
 */
export interface SkillPolicy {
  allowImplicitInvocation: boolean;
  products: string[];
}

export const DEFAULT_POLICY: SkillPolicy = {
  allowImplicitInvocation: true,
  products: [],
};

export function parseAgentPolicy(yaml: string): SkillPolicy {
  const productsMatch = /products:\s*\[([^\]]*)\]/.exec(yaml);
  const products =
    productsMatch?.[1]
      ?.split(",")
      .map((value) => value.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean) ?? [];
  return {
    allowImplicitInvocation: !/allow-implicit-invocation:\s*false/.test(yaml),
    products,
  };
}
