import type { AgentPath } from "@ao/protocol";

export const ROOT_AGENT_PATH: AgentPath = "/root";

const AGENT_NAME_PATTERN = /^[a-z0-9_]+$/;
const RESERVED_NAMES = new Set(["root", ".", ".."]);

export function isValidAgentName(name: string): boolean {
  return (
    name.length > 0 &&
    !RESERVED_NAMES.has(name) &&
    !name.includes("/") &&
    AGENT_NAME_PATTERN.test(name)
  );
}

export function agentPathName(path: AgentPath): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

export function joinAgentPath(parent: AgentPath, name: string): AgentPath {
  if (!isValidAgentName(name)) {
    throw new Error(`invalid agent name: ${name}`);
  }
  return `${parent === "/" ? "" : parent}/${name}`;
}

export function resolveAgentPath(
  callerPath: AgentPath,
  target: string,
): AgentPath {
  if (target === ROOT_AGENT_PATH) return ROOT_AGENT_PATH;
  if (target.startsWith("/")) return target;
  return joinAgentPath(callerPath, target);
}

