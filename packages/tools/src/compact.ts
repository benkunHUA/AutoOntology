import type { ToolHandler } from "@ao/protocol";

/**
 * 模型可主动请求压缩的控制工具。真正压缩由 core 在工具批次关闭后执行。
 */
export const compact: ToolHandler = {
  spec: {
    name: "compact",
    description:
      "Request compaction of the conversation after this tool batch finishes.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    supportsParallel: false,
  },
  async execute() {
    return {
      ok: true,
      output: "Compaction requested after this tool batch.",
    };
  },
};
