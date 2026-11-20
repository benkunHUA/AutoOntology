import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PermissionProfile } from "@ao/protocol";

export interface AppConfig {
  apiKey: string;
  modelName: string;
  baseUrl: string;
  approval: "auto" | "deny";
  skills: boolean;
  sandbox?: SandboxConfig;
}

export interface SandboxConfig {
  writableRoots?: string[];
  deniedReads?: string[];
  network?: boolean;
  networkAllow?: string[];
  networkDeny?: string[];
}

interface ConfigFile {
  api_key?: string;
  model_name?: string;
  base_url?: string;
  approval?: "auto" | "deny";
  skills?: boolean;
  sandbox?: SandboxConfig;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "deepseek-flash";

export async function loadConfig(cwd: string): Promise<AppConfig> {
  const path = resolve(cwd, "ao.config.json");
  let file: ConfigFile = {};

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config must be a JSON object");
    }
    file = parsed as ConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `failed to load config ${path}: ${(error as Error).message}`,
      );
    }
  }

  const env = process.env;
  return {
    apiKey: file.api_key ?? env.OPENAI_API_KEY ?? env.AO_API_KEY ?? "",
    modelName: file.model_name ?? env.AO_MODEL ?? DEFAULT_MODEL,
    baseUrl: file.base_url ?? env.AO_BASE_URL ?? DEFAULT_BASE_URL,
    approval: file.approval ?? "auto",
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
