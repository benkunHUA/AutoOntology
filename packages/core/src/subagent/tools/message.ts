import type { ToolHandler } from "@ao/protocol";
import { requireString } from "../util/args.ts";
import { runAgentTool } from "../util/runner.ts";

type MessageMode = "queue" | "trigger";

function createMessageTool(
  name: "send_message" | "followup_task",
  description: string,
  mode: MessageMode,
): ToolHandler {
  return {
    spec: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Agent 路径（相对或绝对）或线程 id。",
          },
          message: { type: "string", description: "消息内容。" },
        },
        required: ["target", "message"],
        additionalProperties: false,
      },
    },

    execute(args, ctx) {
      const target = requireString(args, "target");
      const message = requireString(args, "message");
      if (!target || !message) {
        return Promise.resolve({
          ok: false,
          output: "target 和 message 是必填参数",
        });
      }
      return runAgentTool(ctx, (agentControl, caller) =>
        agentControl.send(caller, { target, message, mode }),
      );
    },
  };
}

export const sendMessage = createMessageTool(
  "send_message",
  "向已有 agent 发送仅入队的消息，不会唤醒空闲 agent。",
  "queue",
);

export const followupTask = createMessageTool(
  "followup_task",
  "向已有子 agent 发送后续任务并立即唤醒它，不能以 root 为目标。",
  "trigger",
);

