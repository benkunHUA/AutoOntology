import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  CornerDownLeft,
  FilePlus2,
  LoaderCircle,
  MessageSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatItem, ToolCall } from "../domain";
import type { TurnStats } from "../App";
import { Markdown } from "./Markdown";

interface ConversationProps {
  projectName: string;
  items: ChatItem[];
  busy: boolean;
  model: string;
  mock: boolean;
  stats: TurnStats | null;
  onSend(text: string): void;
  onAbort(): void;
  onNewChat(): void;
}

export function Conversation({
  projectName,
  items,
  busy,
  model,
  mock,
  stats,
  onSend,
  onAbort,
  onNewChat,
}: ConversationProps): React.JSX.Element {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items]);

  const submit = (): void => {
    if (input.trim() === "" || busy) return;
    onSend(input);
    setInput("");
  };

  return (
    <main className="conversation">
      <header className="conversation-header">
        <div className="conversation-title">
          <span className="title-text">{projectName}</span>
          {model && (
            <span className={`model-badge ${mock ? "mock" : ""}`}>
              {mock ? "mock" : model}
            </span>
          )}
        </div>
        <div className="header-actions">
          {stats && (
            <span className="turn-stats">
              {stats.inputTokens + stats.outputTokens} tok · {formatDuration(stats.durationMs)}
            </span>
          )}
          <button className="icon-button" onClick={onNewChat} title="新对话">
            <FilePlus2 size={18} />
          </button>
        </div>
      </header>

      <div className="message-scroll" ref={scrollRef}>
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item) => <MessageGroup key={item.id} item={item} />)
        )}
      </div>

      <footer className="composer">
        <textarea
          className="composer-input"
          value={input}
          rows={1}
          placeholder="输入任务，Enter 发送"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-actions">
          <span className="send-hint">
            <CornerDownLeft size={13} />
            Enter
          </span>
          {busy ? (
            <button className="icon-button accent" onClick={onAbort} title="停止">
              <CircleStop size={20} />
            </button>
          ) : (
            <button
              className="icon-button accent"
              onClick={submit}
              disabled={input.trim() === ""}
              title="发送"
            >
              <CornerDownLeft size={20} />
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="empty-state">
      <MessageSquare size={26} />
      <span>开始新的对话</span>
    </div>
  );
}

function MessageGroup({ item }: { item: ChatItem }): React.JSX.Element {
  if (item.role === "status") {
    return <div className="status-line">{item.text}</div>;
  }
  if (item.role === "user") {
    return (
      <div className="message-row user">
        <div className="message-bubble user">{item.text}</div>
      </div>
    );
  }
  return (
    <div className="message-row assistant">
      {item.tools.map((tool) => (
        <ToolRow key={tool.callId} tool={tool} />
      ))}
      {item.text && (
        <div className="message-bubble assistant">
          <Markdown text={item.text} />
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolCall }): React.JSX.Element {
  const statusClass = tool.status;
  return (
    <details className={`tool-call ${statusClass}`}>
      <summary>
        <ToolStatusIcon status={tool.status} />
        <span>{tool.name}</span>
        <span className="tool-duration">
          {tool.durationMs ? `${tool.durationMs}ms` : ""}
        </span>
      </summary>
      {tool.args && (
        <pre className="tool-body">{trimText(tool.args, 800)}</pre>
      )}
      {tool.output && (
        <pre className="tool-body output">{trimText(tool.output, 800)}</pre>
      )}
    </details>
  );
}

function ToolStatusIcon({ status }: { status: ToolCall["status"] }): React.JSX.Element {
  if (status === "running") {
    return <LoaderCircle size={14} className="spin" />;
  }
  if (status === "ok") {
    return <CheckCircle2 size={14} />;
  }
  if (status === "error") {
    return <XCircle size={14} />;
  }
  if (status === "aborted") {
    return <AlertTriangle size={14} />;
  }
  return <Wrench size={14} />;
}

function trimText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
