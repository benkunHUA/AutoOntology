import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatEventEnvelope,
  ChatSnapshot,
  ChatSubmitResult,
  DesktopApi,
  FileNode,
  FilePreview,
  ProjectInfo,
} from "../shared/ipc.ts";

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke("projects:list") as Promise<ProjectInfo[]>,
  addProject: () => ipcRenderer.invoke("projects:add") as Promise<ProjectInfo | null>,
  removeProject: (path) =>
    ipcRenderer.invoke("projects:remove", path) as Promise<ProjectInfo[]>,
  listFiles: (path) => ipcRenderer.invoke("fs:tree", path) as Promise<FileNode>,
  readFile: (path) => ipcRenderer.invoke("fs:read", path) as Promise<FilePreview | null>,
  selectProject: (path) =>
    ipcRenderer.invoke("chat:select", path) as Promise<ChatSnapshot>,
  submit: (path, text) =>
    ipcRenderer.invoke("chat:submit", path, text) as Promise<ChatSubmitResult>,
  abort: (path) => ipcRenderer.invoke("chat:abort", path) as Promise<void>,
  newChat: (path) => ipcRenderer.invoke("chat:new", path) as Promise<ChatSnapshot>,
  onChatEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, envelope: ChatEventEnvelope) =>
      callback(envelope);
    ipcRenderer.on("chat:event", listener);
    return () => ipcRenderer.removeListener("chat:event", listener);
  },
};

contextBridge.exposeInMainWorld("ao", api);
