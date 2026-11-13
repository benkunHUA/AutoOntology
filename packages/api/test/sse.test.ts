import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse.ts";

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSse(stream)) out.push(data);
  return out;
}

function chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return (async function* () {
    for (const part of parts) yield encoder.encode(part);
  })();
}

describe("parseSse", () => {
  it("解析基本事件", async () => {
    expect(
      await collect(chunks('data: {"a":1}\n\ndata: {"b":2}\n\n')),
    ).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("事件边界跨 chunk 切分", async () => {
    expect(
      await collect(chunks('data: {"a"', ":1}\n", "\ndata: {\"b\"", ":2}\n\n")),
    ).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("多字节 UTF-8 字符跨 chunk 切分", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"t":"你好"}\n\n');
    const mid = bytes.indexOf(0xe4) + 1; // 切在「你」的字节中间
    const stream = (async function* () {
      yield bytes.slice(0, mid);
      yield bytes.slice(mid);
    })();
    expect(await collect(stream)).toEqual(['{"t":"你好"}']);
  });

  it("多行 data 以 \\n 拼接", async () => {
    expect(await collect(chunks("data: line1\ndata: line2\n\n"))).toEqual([
      "line1\nline2",
    ]);
  });

  it("忽略注释行与 event 字段", async () => {
    expect(
      await collect(chunks(": keepalive\nevent: message\ndata: x\n\n")),
    ).toEqual(["x"]);
  });

  it("CRLF 分隔", async () => {
    expect(await collect(chunks('data: {"a":1}\r\n\r\n'))).toEqual(['{"a":1}']);
  });

  it("流结束时残留缓冲作为最后一个事件（宽松）", async () => {
    expect(await collect(chunks("data: tail"))).toEqual(["tail"]);
  });
});
