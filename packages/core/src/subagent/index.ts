import type { ToolHandler } from "@ao/protocol";
import { followupTask, sendMessage } from "./tools/message.ts";
import { interruptAgent } from "./tools/interrupt-agent.ts";
import { listAgents } from "./tools/list-agents.ts";
import { spawnAgent } from "./tools/spawn-agent.ts";
import { waitAgent } from "./tools/wait-agent.ts";

export function createSubagentToolHandlers(): ToolHandler[] {
  return [
    spawnAgent,
    sendMessage,
    followupTask,
    listAgents,
    interruptAgent,
    waitAgent,
  ];
}

