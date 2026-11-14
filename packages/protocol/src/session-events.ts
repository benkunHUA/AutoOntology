/** 会话对外事件流：客户端（CLI/TUI/GUI）只依赖这个类型渲染。 */

export type SessionEvent =
  | { type: "turn_started"; turnId: string; at: string }
  | { type: "item_started"; index: number }
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | {
      type: "tool_started";
      callId: string;
      name: string;
      args: string;
    }
  | {
      type: "tool_finished";
      callId: string;
      name: string;
      ok: boolean;
      output: string;
      durationMs: number;
      tags?: Record<string, string>;
    }
  | {
      type: "tool_aborted";
      callId: string;
      name: string;
      output: string;
      durationMs: number;
    }
  | {
      type: "turn_completed";
      turnId: string;
      finalMessage: string | null;
      usage: { inputTokens: number; outputTokens: number };
      durationMs: number;
      firstTokenMs: number | null;
      toolCalls: number;
    }
  | {
      type: "turn_aborted";
      turnId: string;
      reason: "user" | "replaced" | "quota" | "error";
      durationMs: number;
    }
  | { type: "turn_error"; turnId: string; message: string };

export type EventSink = (event: SessionEvent) => void;
