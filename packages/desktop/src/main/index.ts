import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { AgentRuntime } from "./agent.ts";
import { buildFileTree, previewFile } from "./files.ts";
import { ProjectStore } from "./projects.ts";
import type { ChatEventEnvelope } from "../shared/ipc.ts";

let mainWindow: BrowserWindow | null = null;
let runtime: AgentRuntime;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0d0f14",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function sendChatEvent(envelope: ChatEventEnvelope): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("chat:event", envelope);
  }
}

function registerIpc(): void {
  const projects = new ProjectStore(app.getPath("userData"));

  ipcMain.handle("projects:list", () => projects.list());
  ipcMain.handle("projects:add", async () => {
    const result = await dialog.showOpenDialog({
      title: "打开项目",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0]!;
    await projects.add(path);
    const list = await projects.list();
    return list.find((project) => project.path === path) ?? null;
  });
  ipcMain.handle("projects:remove", (_event, path: string) =>
    projects.remove(path),
  );

  ipcMain.handle("fs:tree", (_event, path: string) => buildFileTree(path));
  ipcMain.handle("fs:read", (_event, path: string) => previewFile(path));

  ipcMain.handle("chat:select", (_event, path: string) =>
    runtime.snapshot(path),
  );
  ipcMain.handle("chat:submit", (_event, path: string, text: string) =>
    runtime.submit(path, text),
  );
  ipcMain.handle("chat:abort", (_event, path: string) => runtime.abort(path));
  ipcMain.handle("chat:new", (_event, path: string) => runtime.newChat(path));
}

app.whenReady().then(() => {
  runtime = new AgentRuntime(sendChatEvent);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
