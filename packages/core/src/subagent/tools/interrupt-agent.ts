import type { ToolHandler } from "@ao/protocol";
import { requireString } from "../util/args.ts";
import { runAgentTool } from "../util/runner.ts";

export const interruptAgent: ToolHandler = {
  spec: {
    name: "interrupt_agent",
    description: "中断已有子 agent 的当前回合。",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Agent 路径（相对或绝对）或线程 id。",
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
    return runAgentTool(ctx, (agentControl, caller) =>
      agentControl.interrupt(caller, target),
    );
  },
};

