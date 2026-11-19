/** subagent 工具的参数解析。模型参数是不可信输入，只做宽松解析。 */

export type AgentToolArgs = Record<string, unknown>;

export function requireString(args: AgentToolArgs, name: string): string | null {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}

export function optionalString(
  args: AgentToolArgs,
  name: string,
): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

