/** Windows helper IPC 帧：4 字节小端长度 + UTF-8 JSON，单帧上限 8 MiB。 */
export const MAX_FRAME_LEN = 8 * 1024 * 1024;

export function encodeFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_FRAME_LEN) {
    throw new Error(`frame too large: ${payload.length}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export interface DecodedFrame<T> {
  message: T;
  rest: Buffer;
}

export function decodeFrame<T>(bytes: Buffer): DecodedFrame<T> | null {
  if (bytes.length < 4) return null;
  const length = bytes.readUInt32LE(0);
  if (length > MAX_FRAME_LEN) {
    throw new Error(`frame too large: ${length}`);
  }
  if (bytes.length < 4 + length) return null;
  const payload = bytes.subarray(4, 4 + length);
  return {
    message: JSON.parse(payload.toString("utf8")) as T,
    rest: bytes.subarray(4 + length),
  };
}
