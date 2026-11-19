import type { ToolHandler } from "@ao/protocol";
import { optionalString, requireString } from "../util/args.ts";
import { runAgentTool } from "../util/runner.ts";

export const spawnAgent: ToolHandler = {
  spec: {
    name: "spawn_agent",
    description:
      "创建一个拥有独立线程的子 agent。子 agent 继承当前回合的工作目录、模型和工具集，并立即开始运行。",
    parameters: {
      type: "object",
      properties: {
        path_name: {
          type: "string",
          description: "子 agent 路径名，使用小写 snake_case。",
        },
        message: {
          type: "string",
          description: "发送给子 agent 的初始任务描述。",
        },
        role_name: {
          type: "string",
          description: "可选的子 agent 角色名，默认为 subagent。",
        },
        model: {
          type: "string",
          description: "可选的子 agent 模型覆盖。",
        },
        fork_turns: {
          type: "string",
          enum: ["none", "all"],
          description: "设为 all 时继承父线程历史；其他情况从空历史开始。",
        },
      },
      required: ["path_name", "message"],
      additionalProperties: false,
    },
  },

  execute(args, ctx) {
    const pathName = requireString(args, "path_name");
    const message = requireString(args, "message");
    if (!pathName || !message) {
      return Promise.resolve({
        ok: false,
        output: "path_name 和 message 是必填参数",
      });
    }
    return runAgentTool(ctx, (agentControl, caller) =>
      agentControl.spawn(caller, {
        pathName,
        message,
        roleName: optionalString(args, "role_name"),
        model: optionalString(args, "model"),
        forkHistory: optionalString(args, "fork_turns") === "all",
      }),
    );
  },
};

