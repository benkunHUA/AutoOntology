import type { ToolHandler } from "@ao/protocol";
import { optionalString } from "../util/args.ts";
import { runAgentTool } from "../util/runner.ts";

export const listAgents: ToolHandler = {
  spec: {
    name: "list_agents",
    description: "列出当前 agent 树中已知的 agent。",
    parameters: {
      type: "object",
      properties: {
        path_prefix: {
          type: "string",
          description: "可选的相对或绝对 agent 路径前缀。",
        },
      },
      additionalProperties: false,
    },
    supportsParallel: true,
  },

  execute(args, ctx) {
    return runAgentTool(ctx, (agentControl, caller) =>
      agentControl.list(caller, optionalString(args, "path_prefix")),
    );
  },
};

