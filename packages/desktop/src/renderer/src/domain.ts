import type { HistoryItem, SessionEvent } from "@ao/protocol";

export type ToolStatus = "running" | "ok" | "error" | "aborted";

export interface ToolCall {
  callId: string;
  name: string;
  args: string;
  output: string;
  status: ToolStatus;
  durationMs?: number;
}

export type ChatItem =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; tools: ToolCall[] }
  | { id: string; role: "status"; text: string };

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeHistory(history: HistoryItem[]): ChatItem[] {
  const items: ChatItem[] = [];
  let currentAssistant: Extract<ChatItem, { role: "assistant" }> | null = null;

  for (const item of history) {
    if (item.type === "message") {
      if (item.role === "user") {
        currentAssistant = null;
        items.push({ id: nextId("user"), role: "user", text: item.text });
      } else if (item.role === "assistant") {
        currentAssistant = {
          id: nextId("assistant"),
          role: "assistant",
          text: item.text,
          tools: [],
        };
        items.push(currentAssistant);
      }
      continue;
    }

    if (item.type === "function_call") {
      currentAssistant ??= ensureAssistant(items);
      currentAssistant.tools.push({
        callId: item.callId,
        name: item.name,
        args: item.arguments,
        output: "",
        status: "ok",
      });
      continue;
    }

    if (item.type === "function_call_output") {
      const assistant = findAssistantWithTool(items, item.callId);
      if (!assistant) continue;
      const tool = assistant.tools.find((candidate) => candidate.callId === item.callId);
      if (!tool) continue;
      tool.output = item.output;
      tool.status = item.ok ? "ok" : "error";
      continue;
    }

    if (item.type === "turn_marker") {
      items.push({
        id: nextId("status"),
        role: "status",
        text: markerText(item.kind, item.detail),
      });
    }
  }

  return items;
}

export function applySessionEvent(items: ChatItem[], event: SessionEvent): ChatItem[] {
  const next = [...items];

  switch (event.type) {
    case "turn_started":
      if (lastItem(next)?.role !== "assistant") {
        next.push(createAssistant());
      }
      break;

    case "text_delta": {
      const assistant = ensureAssistant(next);
      assistant.text += event.delta;
      break;
    }

    case "tool_started": {
      const assistant = ensureAssistant(next);
      assistant.tools.push({
        callId: event.callId,
        name: event.name,
        args: event.args,
        output: "",
        status: "running",
      });
      break;
    }

    case "tool_finished": {
      const tool = findTool(next, event.callId);
      if (tool) {
        tool.output = event.output;
        tool.status = event.ok ? "ok" : "error";
        tool.durationMs = event.durationMs;
      }
      break;
    }

    case "tool_aborted": {
      const tool = findTool(next, event.callId);
      if (tool) {
        tool.output = event.output;
        tool.status = "aborted";
        tool.durationMs = event.durationMs;
      }
      break;
    }

    case "turn_completed": {
      const assistant = lastItem(next);
      if (assistant?.role === "assistant" && assistant.text === "" && event.finalMessage) {
        assistant.text = event.finalMessage;
      }
      break;
    }

    case "turn_aborted":
      next.push({
        id: nextId("status"),
        role: "status",
        text: `已中断 (${event.reason})`,
      });
      break;

    case "turn_error":
      next.push({
        id: nextId("status"),
        role: "status",
        text: `回合出错：${event.message}`,
      });
      break;

    case "item_started":
    case "reasoning_delta":
      break;
  }

  return next;
}

function ensureAssistant(items: ChatItem[]): Extract<ChatItem, { role: "assistant" }> {
  const last = lastItem(items);
  if (last?.role === "assistant") return last;
  const assistant = createAssistant();
  items.push(assistant);
  return assistant;
}

function createAssistant(): Extract<ChatItem, { role: "assistant" }> {
  return {
    id: nextId("assistant"),
    role: "assistant",
    text: "",
    tools: [],
  };
}

function lastItem(items: ChatItem[]): ChatItem | undefined {
  return items[items.length - 1];
}

function findAssistantWithTool(
  items: ChatItem[],
  callId: string,
): Extract<ChatItem, { role: "assistant" }> | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (
      item.role === "assistant" &&
      item.tools.some((tool) => tool.callId === callId)
    ) {
      return item;
    }
  }
  return undefined;
}

function findTool(items: ChatItem[], callId: string): ToolCall | undefined {
  const assistant = findAssistantWithTool(items, callId);
  return assistant?.tools.find((tool) => tool.callId === callId);
}

function markerText(kind: "aborted" | "error" | "compacted", detail: string): string {
  if (kind === "aborted") return `已中断：${detail}`;
  if (kind === "error") return `出错：${detail}`;
  return `已压缩上下文：${detail}`;
}
