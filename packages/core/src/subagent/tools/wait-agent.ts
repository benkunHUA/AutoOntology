import type { ToolHandler } from "@ao/protocol";
import { runAgentTool } from "../util/runner.ts";

const MAX_WAIT_TIMEOUT_MS = 300_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export const waitAgent: ToolHandler = {
  spec: {
    name: "wait_agent",
    description: "等待本 agent 队列中的活动：agent 消息、用户插话或超时。",
    parameters: {
      type: "object",
      properties: {
        timeout_ms: {
          type: "integer",
          description: `超时毫秒数，默认 ${DEFAULT_WAIT_TIMEOUT_MS}。`,
        },
      },
      additionalProperties: false,
    },
  },

  execute(args, ctx) {
    const requested =
      typeof args.timeout_ms === "number"
        ? args.timeout_ms
        : DEFAULT_WAIT_TIMEOUT_MS;
    const timeoutMs = Math.min(
      Math.max(1, Math.trunc(requested)),
      MAX_WAIT_TIMEOUT_MS,
    );
    return runAgentTool(ctx, (agentControl, caller) =>
      agentControl.waitForActivity(caller, timeoutMs, ctx.signal),
    );
  },
};

