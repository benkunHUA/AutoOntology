/**
 * 世界状态注入。
 *
 * 每个 contributor 产出一组可比较的片段；WorldStateManager 负责与上次
 * 基线做 diff，并作为带标记的 developer 消息追加到历史。首次进入或换
 * 新窗口时全量注入，同一窗口内只注入差异。
 */
import type { ToolSchemaNode } from "@ao/protocol";
import { message } from "@ao/protocol";
import type { ContextManager } from "./context-manager.ts";

export interface WorldStateFragment {
  readonly key: string;
  readonly text: string;
}

export interface WorldStateCaptureContext {
  readonly cwd: string;
  readonly tools: readonly ToolSchemaNode[];
}

export interface WorldStateContributor {
  readonly id: string;
  capture(
    ctx: WorldStateCaptureContext,
  ): Promise<readonly WorldStateFragment[]> | readonly WorldStateFragment[];
}

export class WorldStateManager {
  private baselines = new Map<string, readonly WorldStateFragment[]>();

  /** 压缩或换新窗口后调用，下一次注入恢复为全量。 */
  resetBaseline(): void {
    this.baselines.clear();
  }

  async inject(
    history: ContextManager,
    contributors: readonly WorldStateContributor[],
    ctx: WorldStateCaptureContext,
    options: { newWindow?: boolean } = {},
  ): Promise<void> {
    if (options.newWindow) this.resetBaseline();

    for (const contributor of contributors) {
      const current = await contributor.capture(ctx);
      const baseline = this.baselines.get(contributor.id);
      if (!baseline) {
        for (const fragment of current) {
          history.append(renderFragment(contributor.id, fragment, false));
        }
      } else {
        const before = new Map(baseline.map((f) => [f.key, f.text]));
        for (const fragment of current) {
          if (before.get(fragment.key) !== fragment.text) {
            history.append(renderFragment(contributor.id, fragment, false));
          }
          before.delete(fragment.key);
        }
        for (const [key] of before) {
          history.append(renderFragment(contributor.id, { key, text: "" }, true));
        }
      }
      this.baselines.set(contributor.id, current);
    }
  }
}

function renderFragment(
  contributorId: string,
  fragment: WorldStateFragment,
  removed: boolean,
) {
  const tag = removed ? `[world_state:${contributorId}:removed]` : `[world_state:${contributorId}]`;
  return message("developer", `${tag} ${fragment.key}\n${fragment.text}`);
}

/** 内置 contributor：环境状态。 */
export class EnvironmentWorldStateContributor implements WorldStateContributor {
  readonly id = "environment";

  capture(ctx: WorldStateCaptureContext): readonly WorldStateFragment[] {
    return [
      {
        key: "workspace",
        text: ctx.cwd,
      },
      {
        key: "shell",
        text: detectShell(),
      },
    ];
  }
}

function detectShell(): string {
  if (process.platform === "win32") return "powershell";
  const fromEnv = process.env.SHELL ?? "";
  const name = fromEnv.split("/").pop() ?? "";
  return name || (process.platform === "linux" ? "bash" : "sh");
}

/** 内置 contributor：本步可见的工具目录。 */
export class ToolCatalogWorldStateContributor implements WorldStateContributor {
  readonly id = "tool_catalog";

  capture(ctx: WorldStateCaptureContext): readonly WorldStateFragment[] {
    return [
      {
        key: "tools",
        text: ctx.tools.map((tool) => tool.name).sort().join("\n"),
      },
    ];
  }
}

export function defaultWorldStateContributors(): WorldStateContributor[] {
  return [new EnvironmentWorldStateContributor(), new ToolCatalogWorldStateContributor()];
}
