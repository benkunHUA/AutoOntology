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
  SkillReadRequest,
  SkillReadResult,
  SkillRoot,
  SkillStepState,
} from "./types.ts";

export interface SkillRuntimeOptions {
  rootResolver?: (ctx: RootResolverContext) => SkillRoot[];
  product?: string;
  includeInstructions?: boolean;
  catalogBudgetChars?: number;
  omitDescriptions?: boolean;
  disabledPaths?: ReadonlySet<string>;
  disabledNames?: ReadonlySet<string>;
}

export class SkillRuntime {
  private stepState: SkillStepState | null = null;
  private hostProvider: HostSkillProvider | null = null;

  constructor(private readonly options: SkillRuntimeOptions = {}) {}

  get product(): string | undefined {
    return this.options.product;
  }

  get currentStep(): SkillStepState | null {
    return this.stepState;
  }

  async prepareStep(input: {
    cwd: string;
    product?: string;
  }): Promise<SkillStepState> {
    const product = input.product ?? this.options.product;
    const roots = this.options.rootResolver
      ? this.options.rootResolver({ cwd: input.cwd })
      : resolveSkillRoots({ cwd: input.cwd });

    const host = new HostSkillProvider({
      roots,
      product,
      disabledPaths: this.options.disabledPaths,
      disabledNames: this.options.disabledNames,
    });
    this.hostProvider = host;

    const catalog = await host.list();
    this.stepState = { catalog };
    return this.stepState;
  }

  async readResource(
    request: Omit<SkillReadRequest, "cursor">,
  ): Promise<SkillReadResult> {
    if (!this.hostProvider) {
      throw new Error("skills not prepared");
    }
    return this.hostProvider.read(request);
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
      const result = await this.readResource({
        entry,
        resource: entry.mainPrompt,
      });
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
