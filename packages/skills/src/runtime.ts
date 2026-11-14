import { mergeCatalogs, SkillCatalog } from "./catalog.ts";
import {
  DEFAULT_CATALOG_BUDGET_CHARS,
  MAIN_PROMPT_BYTES,
  truncateUtf8,
} from "./limits.ts";
import { HostSkillProvider } from "./provider.ts";
import { renderAvailableSkills } from "./render.ts";
import { resolveSkillRoots, type RootResolverContext } from "./roots.ts";
import { selectExplicitSkills } from "./selection.ts";
import type {
  SkillFragment,
  SkillInput,
  SkillProvider,
  SkillRoot,
  SkillSourceKind,
  SkillStepState,
} from "./types.ts";

export interface SkillRuntimeOptions {
  rootResolver?: (ctx: RootResolverContext) => SkillRoot[];
  product?: string;
  includeInstructions?: boolean;
  catalogBudgetChars?: number;
  omitDescriptions?: boolean;
  disabledPaths?: ReadonlySet<string>;
  providers?: Partial<Record<SkillSourceKind, SkillProvider>>;
}

export class SkillRuntime {
  private stepState: SkillStepState | null = null;
  private hostProvider: HostSkillProvider | null = null;
  private readonly providers: Partial<Record<SkillSourceKind, SkillProvider>>;

  constructor(private readonly options: SkillRuntimeOptions = {}) {
    this.providers = options.providers ?? {};
  }

  get product(): string | undefined {
    return this.options.product;
  }

  get currentStep(): SkillStepState | null {
    return this.stepState;
  }

  providerFor(kind: SkillSourceKind): SkillProvider | undefined {
    return this.providers[kind] ?? (kind === "host" ? this.hostProvider ?? undefined : undefined);
  }

  async prepareStep(input: {
    cwd: string;
    pluginRoots?: SkillRoot[];
    selectedRoots?: string[];
    product?: string;
  }): Promise<SkillStepState> {
    const product = input.product ?? this.options.product;
    const roots = this.options.rootResolver
      ? this.options.rootResolver({ cwd: input.cwd, pluginRoots: input.pluginRoots })
      : resolveSkillRoots({ cwd: input.cwd, pluginRoots: input.pluginRoots });

    const host =
      this.providers.host ??
      new HostSkillProvider({
        roots,
        product,
        disabledPaths: this.options.disabledPaths,
      });
    if (host instanceof HostSkillProvider) this.hostProvider = host;

    const hostCatalog = await host.list({ turnId: "turn" });
    const [cloud, executor] = await Promise.all([
      this.providers.cloud
        ? this.providers.cloud.list({ turnId: "step", includeCloudSkills: true })
        : Promise.resolve<SkillCatalog | null>(null),
      this.providers.executor
        ? this.providers.executor.list({ executorRoots: input.selectedRoots ?? [] })
        : Promise.resolve(new SkillCatalog()),
    ]);

    const catalog = mergeCatalogs(cloud, executor).extend(hostCatalog);
    const toolsEnabled = Boolean(
      this.providers.cloud || (input.selectedRoots?.length ?? 0) > 0,
    );
    this.stepState = { hostCatalog, catalog, toolsEnabled };
    return this.stepState;
  }

  renderCatalog(step: SkillStepState): string {
    return renderAvailableSkills(step.catalog, {
      budgetChars: this.options.catalogBudgetChars ?? DEFAULT_CATALOG_BUDGET_CHARS,
      omitDescriptions: this.options.omitDescriptions,
    });
  }

  async collectSkillFragments(
    inputs: readonly SkillInput[],
    step: SkillStepState,
  ): Promise<SkillFragment[]> {
    const fragments: SkillFragment[] = [];
    for (const entry of selectExplicitSkills(inputs, step.catalog)) {
      const provider = this.providerFor(entry.authority.kind);
      if (!provider) continue;
      const result = await provider.read({ entry, resource: entry.mainPrompt });
      fragments.push({
        role: "user",
        name: entry.name,
        path: entry.mainPrompt,
        content: truncateUtf8(result.contents, MAIN_PROMPT_BYTES),
      });
    }
    return fragments;
  }
}
