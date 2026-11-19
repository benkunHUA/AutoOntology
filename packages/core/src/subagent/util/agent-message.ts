import type { AgentPath } from "@ao/protocol";

export function formatAgentMessage(
  author: AgentPath,
  recipient: AgentPath,
  content: string,
): string {
  return `[agent ${author} → ${recipient}]\n${content}`;
}

export function formatAgentCompletion(
  childPath: AgentPath,
  finalMessage: string | null,
): string {
  return `[agent ${childPath} completed]${finalMessage ? `\n${finalMessage}` : ""}`;
}

