import type { ToolHandler } from "@ao/protocol";
import { requireString } from "../util/args.ts";
import { runAgentTool } from "../util/runner.ts";

const MAX_WAIT_TIMEOUT_MS = 300_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export const waitAgent: ToolHandler = {
  spec: {
    name: "wait_agent",
    description:
      "暂停当前回合，等待已派发的子 agent 返回结果或收到新消息。通常在 spawn_agent 或 followup_task 之后调用；收到子 agent 完成通知、用户插话或超时时返回。",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "要等待的目标 agent 路径或线程 id。",
        },
        timeout_ms: {
          type: "integer",
          description: `最长等待毫秒数，默认 ${DEFAULT_WAIT_TIMEOUT_MS}，最大 ${MAX_WAIT_TIMEOUT_MS}。`,
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  },

  execute(args, ctx) {
    const target = requireString(args, "target");
    if (!target) {
      return Promise.resolve({ ok: false, output: "target 是必填参数" });
    }
    const requested =
      typeof args.timeout_ms === "number"
        ? args.timeout_ms
        : DEFAULT_WAIT_TIMEOUT_MS;
    const timeoutMs = Math.min(
      Math.max(1, Math.trunc(requested)),
      MAX_WAIT_TIMEOUT_MS,
    );
    return runAgentTool(ctx, (agentControl, caller) =>
      agentControl.waitForActivity(
        caller,
        timeoutMs,
        ctx.signal,
        target,
      ),
    );
  },
};

