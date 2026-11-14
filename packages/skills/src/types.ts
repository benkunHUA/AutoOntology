export type SkillScope = "repo" | "user" | "system" | "admin";
export type SkillSourceKind = "host" | "executor" | "cloud" | "custom";

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

export interface SkillListQuery {
  turnId?: string;
  includeCloudSkills?: boolean;
  executorRoots?: string[];
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

export interface SkillSearchRequest {
  query: string;
}

export interface SkillSearchResult {
  results: SkillCatalogEntry[];
}

export interface SkillProvider {
  readonly kind: SkillSourceKind;
  usesMcpResources(): boolean;
  list(query: SkillListQuery): Promise<SkillCatalogLike>;
  read(request: SkillReadRequest): Promise<SkillReadResult>;
  search(request: SkillSearchRequest): Promise<SkillSearchResult>;
}

export interface SkillLoadOutcome {
  skills: SkillMetadata[];
  warnings: { path: string; message: string }[];
}

export interface SkillStepState {
  hostCatalog: SkillCatalogLike;
  catalog: SkillCatalogLike;
  toolsEnabled: boolean;
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
