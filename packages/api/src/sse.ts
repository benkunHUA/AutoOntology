/**
 * 增量 SSE 解析器。
 *
 * 输入是任意切分的 Uint8Array 块（fetch body 的 chunk 边界与事件边界无关），
 * 输出是逐个 data 负载。处理规则：
 * - 事件以空行分隔（\n\n 或 \r\n\r\n）
 * - 多行 data 以 \n 拼接
 * - 注释行（: 开头）与 event/id/retry 字段忽略（我们只消费 data）
 * - 流结束时把残留缓冲作为最后一个事件（宽松处理，容忍服务端省略尾部空行）
 */
export async function* parseSse(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = "";

  const takeEvents = function* (flush: boolean): Generator<string> {
    // 统一换行，简化按块查找
    buffer = buffer.replace(/\r\n/g, "\n");
    for (;;) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      yield* parseEventBlock(raw);
    }
    if (flush && buffer.trim().length > 0) {
      const raw = buffer;
      buffer = "";
      yield* parseEventBlock(raw);
    }
  };

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    yield* takeEvents(false);
  }
  buffer += decoder.decode();
  yield* takeEvents(true);
}

function* parseEventBlock(raw: string): Generator<string> {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      // 规范允许 "data:" 后有一个可选空格
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // event:/id:/retry: 字段本次不使用
  }
  if (dataLines.length > 0) yield dataLines.join("\n");
}
