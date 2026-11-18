import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
} from "@ao/protocol";

/**
 * 会话级审批缓存：内层 gate 返回 approved_for_session 时，
 * 后续相同的「工具 + 动作」直接复用，不再打扰用户。
 */
export class CachingApprovalGate implements ApprovalGate {
  private readonly approved = new Set<string>();

  constructor(private readonly inner: ApprovalGate) {}

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const key = `${request.toolName}\u0000${request.action}`;
    if (this.approved.has(key)) return "approved_for_session";
    const decision = await this.inner.request(request);
    if (decision === "approved_for_session") this.approved.add(key);
    return decision;
  }
}
