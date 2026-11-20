import { MockModelClient, ResponsesClient } from "@ao/api";
import {
  createSubagentToolHandlers,
  ThreadManager,
  type ThreadOptions,
} from "@ao/core";
import type {
  ApprovalGate,
  ModelClient,
  SessionEvent,
} from "@ao/protocol";
import { defaultTools } from "@ao/tools";
import { resolve } from "node:path";
import { loadConfig, resolveSandboxProfile } from "./config.ts";
import type {
  ChatEventEnvelope,
  ChatSnapshot,
  ChatSubmitResult,
} from "../shared/ipc.ts";

const SYSTEM_INSTRUCTIONS = [
  "You are a coding agent working in the user's workspace.",
  "Use the provided tools to inspect and modify files, and to run commands.",
  "Work incrementally: take one step, observe the result, then continue.",
  "If a command fails, do not retry the same command more than once; read the error and switch to a simpler or platform-compatible approach.",
  "When the task is done, reply with a short summary of what you did.",
].join("\n");

interface ActiveProject {
  manager: ThreadManager;
  threadId: string;
  model: string;
  mock: boolean;
}

export class AgentRuntime {
  private readonly projects = new Map<string, ActiveProject>();

  constructor(
    private readonly forward: (envelope: ChatEventEnvelope) => void,
  ) {}

  async snapshot(projectPath: string): Promise<ChatSnapshot> {
    const project = await this.ensure(projectPath);
    const thread = project.manager.get(project.threadId);
    if (!thread) throw new Error("thread not found");
    return {
      projectPath,
      threadId: thread.threadId,
      sessionId: thread.sessionId,
      model: project.model,
      mock: project.mock,
      busy: thread.isBusy,
      history: thread.history.serialize(),
    };
  }

  async submit(
    projectPath: string,
    text: string,
  ): Promise<ChatSubmitResult> {
    const project = await this.ensure(projectPath);
    const thread = project.manager.get(project.threadId);
    if (!thread) throw new Error("thread not found");
    const status = await thread.submit(text);
    return { status };
  }

  async abort(projectPath: string): Promise<void> {
    const project = await this.ensure(projectPath);
    await project.manager.get(project.threadId)?.abort("user");
  }

  async newChat(projectPath: string): Promise<ChatSnapshot> {
    const existing = this.projects.get(resolve(projectPath));
    if (!existing) return this.snapshot(projectPath);

    const project = await this.ensure(projectPath);
    const thread = project.manager.createRootLike();
    project.threadId = thread.threadId;
    return this.snapshot(projectPath);
  }

  private async ensure(projectPath: string): Promise<ActiveProject> {
    const normalized = resolve(projectPath);
    const existing = this.projects.get(normalized);
    if (existing) return existing;

    const config = await loadConfig(normalized);
    const mock = config.apiKey === "";
    const client: ModelClient = mock
      ? new MockModelClient()
      : new ResponsesClient({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        });
    const approval: ApprovalGate = {
      async request(request) {
        if (request.requiresHuman) return "denied";
        return config.approval === "auto" ? "approved" : "denied";
      },
    };

    const manager = new ThreadManager();
    const options: ThreadOptions = {
      cwd: normalized,
      model: mock ? "mock" : config.modelName,
      instructions: SYSTEM_INSTRUCTIONS,
      client,
      handlers: [...defaultTools(), ...createSubagentToolHandlers()],
      approval,
      skills: { enabled: config.skills },
      agentControl: manager,
      permissionProfile: resolveSandboxProfile(normalized, config),
      emit: (event: SessionEvent) =>
        this.forwardThreadEvent(normalized, manager, event),
      persistenceDir: resolve(normalized, ".ao", "sessions"),
    };

    const thread = manager.createRoot(options);
    const project = {
      manager,
      threadId: thread.threadId,
      model: mock ? "mock" : config.modelName,
      mock,
    };
    this.projects.set(normalized, project);
    return project;
  }

  private forwardThreadEvent(
    projectPath: string,
    manager: ThreadManager,
    event: SessionEvent,
  ): void {
    const threadId = manager.currentThreadId ?? "";
    this.forward({ projectPath, threadId, event });
  }
}
