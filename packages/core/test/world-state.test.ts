import { describe, expect, it } from "vitest";
import { ContextManager } from "../src/context/context-manager.ts";
import {
  WorldStateManager,
  type WorldStateCaptureContext,
  type WorldStateContributor,
} from "../src/context/world-state.ts";

class FakeContributor implements WorldStateContributor {
  readonly id = "fake";
  private fragments = [
    { key: "a", text: "one" },
    { key: "b", text: "two" },
  ];

  setFragments(fragments: Array<{ key: string; text: string }>): void {
    this.fragments = fragments;
  }

  capture(): Array<{ key: string; text: string }> {
    return this.fragments;
  }
}

const ctx: WorldStateCaptureContext = { cwd: "/tmp", tools: [] };

describe("WorldStateManager", () => {
  it("首次全量，同窗口只注入差异，换新窗口恢复全量", async () => {
    const history = new ContextManager();
    const manager = new WorldStateManager();
    const contributor = new FakeContributor();

    await manager.inject(history, [contributor], ctx);
    expect(history.serialize().map((item) =>
      item.type === "message" ? item.text.split("\n")[0] : item.type,
    )).toEqual([
      "[world_state:fake] a",
      "[world_state:fake] b",
    ]);

    contributor.setFragments([
      { key: "a", text: "one" },
      { key: "b", text: "changed" },
      { key: "c", text: "three" },
    ]);
    await manager.inject(history, [contributor], ctx);
    const tags = history
      .serialize()
      .filter((item) => item.type === "message")
      .map((item) => item.text.split("\n")[0]);
    expect(tags).toEqual([
      "[world_state:fake] a",
      "[world_state:fake] b",
      "[world_state:fake] b",
      "[world_state:fake] c",
    ]);

    await manager.inject(history, [contributor], ctx, { newWindow: true });
    expect(history.serialize().filter((item) => item.type === "message")).toHaveLength(7);
  });

  it("片段消失时追加 removed 通知", async () => {
    const history = new ContextManager();
    const manager = new WorldStateManager();
    const contributor = new FakeContributor();

    await manager.inject(history, [contributor], ctx);
    contributor.setFragments([{ key: "a", text: "one" }]);
    await manager.inject(history, [contributor], ctx);

    const tags = history
      .serialize()
      .filter((item) => item.type === "message")
      .map((item) => item.text.split("\n")[0]);
    expect(tags.at(-1)).toBe("[world_state:fake:removed] b");
  });
});
