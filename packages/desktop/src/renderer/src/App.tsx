import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatEventEnvelope,
  FileNode,
  FilePreview,
  ProjectInfo,
} from "../../shared/ipc";
import { Conversation } from "./components/Conversation";
import { FilePanel } from "./components/FilePanel";
import { Sidebar } from "./components/Sidebar";
import {
  applySessionEvent,
  normalizeHistory,
  type ChatItem,
} from "./domain";

export interface TurnStats {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [rightTab, setRightTab] = useState<"files" | "preview">("files");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [mock, setMock] = useState(false);
  const [stats, setStats] = useState<TurnStats | null>(null);
  const activePathRef = useRef<string | null>(null);

  const openProject = useCallback(async (project: ProjectInfo) => {
    setActiveProject(project);
    activePathRef.current = project.path;
    setSelectedFile(null);
    setPreview(null);
    setRightTab("files");
    setBusy(false);
    setStats(null);

    const [treeResult, snapshot] = await Promise.all([
      window.ao.listFiles(project.path).catch(() => null),
      window.ao.selectProject(project.path),
    ]);
    setTree(treeResult);
    setItems(normalizeHistory(snapshot.history));
    setBusy(snapshot.busy);
    setModel(snapshot.model);
    setMock(snapshot.mock);
  }, []);

  useEffect(() => {
    let disposed = false;
    void window.ao.listProjects().then(async (list) => {
      if (disposed) return;
      setProjects(list);
      const first = list[0];
      if (first) await openProject(first);
    });
    return () => {
      disposed = true;
    };
  }, [openProject]);

  useEffect(() => {
    const unsubscribe = window.ao.onChatEvent((envelope: ChatEventEnvelope) => {
      if (envelope.projectPath !== activePathRef.current) return;
      setItems((current) => applySessionEvent(current, envelope.event));
    if (envelope.event.type === "turn_completed") {
      setStats({
        inputTokens: envelope.event.usage.inputTokens,
        outputTokens: envelope.event.usage.outputTokens,
        durationMs: envelope.event.durationMs,
      });
    }
      if (
        envelope.event.type === "turn_completed" ||
        envelope.event.type === "turn_aborted" ||
        envelope.event.type === "turn_error"
      ) {
        setBusy(false);
      }
    });
    return unsubscribe;
  }, []);

  const addProject = async (): Promise<void> => {
    const added = await window.ao.addProject();
    if (!added) return;
    const list = await window.ao.listProjects();
    setProjects(list);
    await openProject(added);
  };

  const removeProject = async (project: ProjectInfo): Promise<void> => {
    const list = await window.ao.removeProject(project.path);
    setProjects(list);
    if (activeProject?.path === project.path) {
      const next = list[0] ?? null;
      setActiveProject(null);
      activePathRef.current = null;
      setTree(null);
      setItems([]);
      setSelectedFile(null);
      setPreview(null);
      if (next) await openProject(next);
    }
  };

  const selectFile = async (path: string): Promise<void> => {
    setSelectedFile(path);
    setRightTab("preview");
    const result = await window.ao.readFile(path);
    setPreview(result);
  };

  const sendMessage = async (text: string): Promise<void> => {
    const project = activeProject;
    if (!project || text.trim() === "") return;
    const clean = text.trim();
    setItems((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: clean },
    ]);
    setBusy(true);
    await window.ao.submit(project.path, clean);
  };

  const abortTurn = async (): Promise<void> => {
    if (!activeProject) return;
    await window.ao.abort(activeProject.path);
  };

  const newChat = async (): Promise<void> => {
    if (!activeProject) return;
    const snapshot = await window.ao.newChat(activeProject.path);
    setItems(normalizeHistory(snapshot.history));
    setBusy(snapshot.busy);
    setModel(snapshot.model);
    setMock(snapshot.mock);
    setStats(null);
  };

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        activePath={activeProject?.path ?? null}
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((value) => !value)}
        onSelect={openProject}
        onAdd={addProject}
        onRemove={removeProject}
      />
      <Conversation
        projectName={activeProject?.name ?? "AutoOntology"}
        items={items}
        busy={busy}
        model={model}
        mock={mock}
        stats={stats}
        onSend={sendMessage}
        onAbort={abortTurn}
        onNewChat={newChat}
      />
      <FilePanel
        collapsed={rightCollapsed}
        tab={rightTab}
        tree={tree}
        selectedFile={selectedFile}
        preview={preview}
        onToggle={() => setRightCollapsed((value) => !value)}
        onTabChange={setRightTab}
        onSelect={selectFile}
        onBack={() => setRightTab("files")}
      />
    </div>
  );
}
