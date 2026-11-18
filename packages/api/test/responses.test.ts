import { describe, expect, it } from "vitest";
import type { ModelRequest, ResponseEvent } from "@ao/protocol";
import { ResponsesClient } from "../src/responses.ts";

function sseResponse(payload: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function request(): ModelRequest {
  return { model: "m", instructions: "", input: [], tools: [] };
}

async function collect(payload: string): Promise<ResponseEvent[]> {
  const client = new ResponsesClient({
    apiKey: "sk-test",
    fetchImpl: async () => sseResponse(payload),
  });
  const events: ResponseEvent[] = [];
  for await (const event of client.stream(request(), {
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

describe("ResponsesClient", () => {
  it("解析 response.completed 与 usage", async () => {
    const events = await collect(
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
    );
    expect(events).toEqual([
      {
        type: "response_completed",
        needsContinue: false,
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    ]);
  });

  it("[DONE] 哨兵作为正常流结束，不抛传输错误", async () => {
    const events = await collect(
      'data: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: [DONE]\n\n',
    );
    expect(events).toEqual([
      { type: "text_delta", index: 0, delta: "hi" },
    ]);
  });
});
