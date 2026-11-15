/**
 * 技能系统的领域模型与接口。
 *
 * 只包含跨模块共享的类型定义，不引入运行时逻辑；
 * 其他模块单向依赖本文件，保证类型边界清晰。
 */
export type SkillScope = "repo" | "user" | "system" | "admin";
export type SkillSourceKind = "host";

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  pathToSkillMd: string;
  scope: SkillScope;
  pluginId?: string;
  remotePluginId?: string;
  allowImplicitInvocation: boolean;
  products: string[];
}

export interface SkillAuthority {
  kind: SkillSourceKind;
  id: string;
}

export interface SkillPackageId {
  value: string;
}

export interface SkillResourceId {
  uri: string;
  environmentId?: string;
  packageRoot?: string;
}

export interface SkillSourceLocation {
  authority: SkillAuthority;
  package: SkillPackageId;
  mainPrompt: SkillResourceId;
  displayPath: string;
  pluginId?: string;
  enabled: boolean;
  promptVisible: boolean;
}

export interface SkillToolDependency {
  type: string;
  value: string;
  description?: string;
}

export interface SkillCatalogEntry {
  id: string;
  environmentId?: string;
  authority: SkillAuthority;
  name: string;
  description: string;
  shortDescription?: string;
  mainPrompt: string;
  displayPath?: string;
  sources?: SkillSourceLocation[];
  dependencies?: { tools: SkillToolDependency[] };
  enabled: boolean;
  promptVisible: boolean;
  pluginId?: string;
  remotePluginId?: string;
}

export interface SkillCatalogLike {
  readonly entries: SkillCatalogEntry[];
  readonly warnings: string[];
  readonly isPartial: boolean;
  pushEntry(entry: SkillCatalogEntry): void;
  extend(other: SkillCatalogLike): this;
  visible(): SkillCatalogEntry[];
}

export interface SkillRoot {
  path: string;
  scope: SkillScope;
  pluginId?: string;
}

export interface SkillReadRequest {
  entry: SkillCatalogEntry;
  resource: string;
  cursor?: number;
}

export interface SkillReadResult {
  resource: string;
  contents: string;
  nextCursor: string | null;
}

export interface SkillLoadOutcome {
  skills: SkillMetadata[];
  warnings: { path: string; message: string }[];
}

export interface SkillStepState {
  catalog: SkillCatalogLike;
}

export interface SkillFragment {
  role: "developer" | "user";
  name?: string;
  path?: string;
  content: string;
}

export interface SkillInput {
  type: "text" | "skill";
  text?: string;
  path?: string;
}
