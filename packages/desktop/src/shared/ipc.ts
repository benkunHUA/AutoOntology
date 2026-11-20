import type { HistoryItem, SessionEvent } from "@ao/protocol";

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  truncated?: boolean;
}

export interface FilePreview {
  path: string;
  content: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

export interface ChatSnapshot {
  projectPath: string;
  threadId: string;
  sessionId: string;
  model: string;
  mock: boolean;
  busy: boolean;
  history: HistoryItem[];
}

export interface ChatSubmitResult {
  status: "started" | "steered" | "rejected";
}

export interface ChatEventEnvelope {
  projectPath: string;
  threadId: string;
  event: SessionEvent;
}

export interface DesktopApi {
  listProjects(): Promise<ProjectInfo[]>;
  addProject(): Promise<ProjectInfo | null>;
  removeProject(path: string): Promise<ProjectInfo[]>;
  listFiles(path: string): Promise<FileNode>;
  readFile(path: string): Promise<FilePreview | null>;
  selectProject(path: string): Promise<ChatSnapshot>;
  submit(path: string, text: string): Promise<ChatSubmitResult>;
  abort(path: string): Promise<void>;
  newChat(path: string): Promise<ChatSnapshot>;
  onChatEvent(callback: (envelope: ChatEventEnvelope) => void): () => void;
}
