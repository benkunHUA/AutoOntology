import { createSkillTools, SkillRuntime } from "@ao/skills";
import type { SkillScope, SkillStepState } from "@ao/skills";
import type { ToolHandler } from "@ao/protocol";
import { message } from "@ao/protocol";
import type { ContextManager } from "./context-manager.ts";
import type { TurnContext } from "./turn-context.ts";

export interface SkillsOptions {
  enabled?: boolean;
  roots?: readonly { path: string; scope?: SkillScope }[];
  includeInstructions?: boolean;
  catalogBudgetChars?: number;
  omitDescriptions?: boolean;
  disabledPaths?: ReadonlySet<string>;
  disabledNames?: ReadonlySet<string>;
}

export function createSkillRuntime(
  options: SkillsOptions | undefined,
): SkillRuntime | null {
  if (!options || options.enabled === false) return null;
  return new SkillRuntime({
    includeInstructions: options.includeInstructions,
    catalogBudgetChars: options.catalogBudgetChars,
    omitDescriptions: options.omitDescriptions,
    disabledPaths: options.disabledPaths,
    disabledNames: options.disabledNames,
    rootResolver: options.roots
      ? () =>
          options.roots!.map((root) => ({
            path: root.path,
            scope: root.scope ?? "user",
          }))
      : undefined,
  });
}

export function createSkillToolHandlers(runtime: SkillRuntime): ToolHandler[] {
  return createSkillTools(runtime);
}

export interface PreparedTurnSkills {
  runtime: SkillRuntime;
  step: SkillStepState;
  injectedPaths: Set<string>;
}

export async function prepareTurnSkills(
  runtime: SkillRuntime | null,
  turn: TurnContext,
  history: ContextManager,
  initialText: string,
): Promise<PreparedTurnSkills | null> {
  if (!runtime) return null;
  let step: SkillStepState;
  try {
    step = await runtime.prepareStep({ cwd: turn.cwd });
  } catch (error) {
    console.warn(`[skills] prepare failed: ${(error as Error).message}`);
    return null;
  }
  const injected = new Set<string>();
  const catalog = runtime.renderCatalog(step);
  if (catalog.trim()) history.append(message("developer", catalog));
  await injectSkillMentions(runtime, step, injected, history, initialText);
  return { runtime, step, injectedPaths: injected };
}

export async function injectSkillMentions(
  runtime: SkillRuntime,
  step: SkillStepState,
  injectedPaths: Set<string>,
  history: ContextManager,
  text: string,
): Promise<void> {
  let fragments;
  try {
    fragments = await runtime.collectSkillFragments(
      [{ type: "text", text }],
      step,
    );
  } catch (error) {
    console.warn(`[skills] mention failed: ${(error as Error).message}`);
    return;
  }
  for (const fragment of fragments) {
    const key = fragment.path ?? fragment.name ?? fragment.content.slice(0, 64);
    if (injectedPaths.has(key)) continue;
    injectedPaths.add(key);
    history.append(message("user", formatSkillFragment(fragment)));
  }
}

function formatSkillFragment(fragment: {
  name?: string;
  content: string;
}): string {
  const header = fragment.name ? `Skill: ${fragment.name}` : "Skill";
  return `${header}\n\n${fragment.content}`;
}
