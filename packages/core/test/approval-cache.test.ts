import { describe, expect, it } from "vitest";
import type { ApprovalGate } from "@ao/protocol";
import { CachingApprovalGate } from "../src/approval-cache.ts";

function gate(decisions: string[]): ApprovalGate {
  let calls = 0;
  return {
    async request() {
      const decision = decisions[Math.min(calls, decisions.length - 1)] ?? "denied";
      calls++;
      return decision as "approved" | "approved_for_session" | "denied";
    },
  };
}

describe("CachingApprovalGate", () => {
  it("approved_for_session 后复用同一动作，不再询问内层", async () => {
    const inner = gate(["approved_for_session", "denied"]);
    const cached = new CachingApprovalGate(inner);
    const request = { toolName: "exec_command", callId: "c1", action: "exec: ls" };

    expect(await cached.request(request)).toBe("approved_for_session");
    expect(await cached.request(request)).toBe("approved_for_session");
  });

  it("普通 approved 不缓存，后续仍询问内层", async () => {
    const inner = gate(["approved", "denied"]);
    const cached = new CachingApprovalGate(inner);
    const request = { toolName: "exec_command", callId: "c1", action: "exec: ls" };

    expect(await cached.request(request)).toBe("approved");
    expect(await cached.request(request)).toBe("denied");
  });
});
