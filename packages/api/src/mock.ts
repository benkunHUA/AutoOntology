/**
 * Mock 模型客户端：离线开发与端到端测试用。
 *
 * 行为（脚本化两幕）：
 * 1. 若历史里最后一个条目不是 function_call_output：
 *    发一个 exec_command 工具调用（ls），response_completed(needsContinue=true)
 * 2. 否则：流式吐一段总结文本并正常完成
 *
 * 这一条路径覆盖了采样循环最关键的往返：工具调用 → 执行 → 回填 → 继续。
 */
import type {
  ModelClient,
  ModelRequest,
  ResponseEvent,
  StreamOptions,
} from "@ao/protocol";

export interface MockClientOptions {
  /** 每个文本增量的延迟，模拟流式节奏（测试里设 0）。 */
  deltaDelayMs?: number;
}

export class MockModelClient implements ModelClient {
  readonly id = "mock";
  private readonly deltaDelayMs: number;
  private turnCount = 0;

  constructor(options: MockClientOptions = {}) {
    this.deltaDelayMs = options.deltaDelayMs ?? 15;
  }

  async *stream(
    request: ModelRequest,
    options: StreamOptions,
  ): AsyncIterable<ResponseEvent> {
    const last = request.input.at(-1);
    const toolsAvailable = request.tools.some((t) => t.name === "exec_command");

    if (last?.type !== "function_call_output" && toolsAvailable) {
      this.turnCount++;
      const callId = `call_mock_${this.turnCount}`;
      yield { type: "item_started", index: 0 };
      yield {
        type: "item_done",
        index: 0,
        item: {
          type: "function_call",
          callId,
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "ls", workdir: "." }),
        },
      };
      yield { type: "response_completed", needsContinue: true };
      return;
    }

    const userText = [...request.input]
      .reverse()
      .find((i) => i.type === "message" && i.role === "user");
    const echoed =
      userText && userText.type === "message" ? userText.text : "(no input)";
    const toolOutput =
      last?.type === "function_call_output" ? last.output : "(无)";

    const reply =
      `[mock] 收到：${echoed}\n` +
      `[mock] 上一步 exec_command 结果：\n${toolOutput}\n` +
      `[mock] 本轮 agent loop 往返完成。`;

    yield { type: "item_started", index: 0 };
    let text = "";
    for (const chunk of chunkText(reply, 12)) {
      if (options.signal.aborted) return;
      if (this.deltaDelayMs > 0) await delay(this.deltaDelayMs, options.signal);
      text += chunk;
      yield { type: "text_delta", index: 0, delta: chunk };
    }
    yield {
      type: "item_done",
      index: 0,
      item: { type: "message", role: "assistant", text },
    };
    yield {
      type: "response_completed",
      needsContinue: false,
      usage: { inputTokens: estimateTokens(request), outputTokens: text.length },
    };
  }
}

function* chunkText(text: string, size: number): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

function estimateTokens(request: ModelRequest): number {
  const chars = request.input.reduce(
    (n, item) =>
      n +
      (item.type === "message"
        ? item.text.length
        : item.type === "function_call"
          ? item.arguments.length + item.name.length
          : item.type === "function_call_output"
            ? item.output.length
            : item.detail.length),
    0,
  );
  return Math.ceil(chars / 4);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}
