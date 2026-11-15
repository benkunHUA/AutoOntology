/** 解析 agents/openai.yaml 的技能策略。 */
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
