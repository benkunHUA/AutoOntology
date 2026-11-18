/**
 * CLI 配置加载。
 *
 * 默认读取 cwd/ao.config.json；可通过 --config <path> 或 AO_CONFIG 指定。
 * 优先级：环境变量 > 配置文件 > 内置默认值。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PermissionProfile } from "@ao/protocol";

export interface SandboxConfig {
  writableRoots?: string[];
  deniedReads?: string[];
  network?: boolean;
  networkAllow?: string[];
  networkDeny?: string[];
}

export interface AppConfig {
  apiKey: string;
  modelName: string;
  baseUrl: string;
  approval?: ApprovalMode;
  skills: boolean;
  sandbox?: SandboxConfig;
}

interface ConfigFile {
  api_key?: string;
  model_name?: string;
  base_url?: string;
  approval?: ApprovalMode;
  skills?: boolean;
  sandbox?: SandboxConfig;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "deepseek-flash";
export type ApprovalMode = "auto" | "deny";

export async function loadConfigFile(
  cwd: string,
  explicitPath?: string,
): Promise<ConfigFile> {
  const path = explicitPath
    ? resolve(cwd, explicitPath)
    : resolve(cwd, "ao.config.json");

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config must be a JSON object");
    }
    return parsed as ConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !explicitPath) {
      return {};
    }
    throw new Error(`failed to load config ${path}: ${(error as Error).message}`);
  }
}

export function resolveConfig(file: ConfigFile): AppConfig {
  const env = process.env;
  return {
    apiKey: file.api_key ?? env.OPENAI_API_KEY ?? env.AO_API_KEY ?? "",
    modelName: file.model_name ?? env.AO_MODEL ?? DEFAULT_MODEL,
    baseUrl: file.base_url ?? env.AO_BASE_URL ?? DEFAULT_BASE_URL,
    approval: file.approval,
    skills: file.skills ?? true,
    sandbox: file.sandbox,
  };
}

export function resolveSandboxProfile(
  cwd: string,
  config: AppConfig,
): PermissionProfile {
  const sandbox = config.sandbox ?? {};
  const writableRoots = sandbox.writableRoots ?? [];
  return {
    filesystem: {
      kind: "restricted",
      writableRoots: writableRoots.length > 0 ? writableRoots : [cwd],
      deniedReads: sandbox.deniedReads ?? [],
    },
    network: {
      enabled: sandbox.network ?? false,
      allowedHosts: sandbox.networkAllow,
      deniedHosts: sandbox.networkDeny,
    },
  };
}
