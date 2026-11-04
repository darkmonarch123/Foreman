import { analyze } from "@/lib/assistant/analyze";
import { templateContextFor } from "@/lib/assistant/template-context";
import type {
  AssistantAcceptResult,
  AssistantFeedback,
  FeedbackRequest,
  FeedbackSummary,
  AssistantProposalRecord,
  AssistantRunRequest,
  AssistantRunResult,
  AssistantServices,
  ProposalDraft,
  StaleReason,
} from "@/lib/assistant/types";
import type { BoardRole, CanvasObject, ServerOperation } from "@/lib/board/types";
import { AppError } from "@/lib/errors";
import type { FakeBoardServer } from "./fake-board-server";

/**
 * TEST ONLY. The Assistant's server side over an in-memory board: the same rule engine as
 * production, plus the database functions' rules (roles, creator-only, one-shot accept,
 * stale checks on target and evidence versions, idempotent apply). The real behaviour is
 * covered against PGlite in tests/db/assistant.test.ts.
 */
export class MemoryAssistant {
  proposals = new Map<string, AssistantProposalRecord>();
  /** Who created each proposal. */
  private owners = new Map<string, string>();
  private counter = 0;
  /** Operation log for audit-style assertions: "<event> <proposal id>". */
  events: string[] = [];
  /** Feedback per proposal (the proposal's owner is the only one who can give it). */
  feedback = new Map<string, AssistantFeedback>();
  /** Hidden rule ids per user. */
  hidden = new Map<string, Set<string>>();

  constructor(
    private readonly board: FakeBoardServer,
    private readonly roleOf: (userId: string) => BoardRole | null,
    private readonly boardId = "board",
    private readonly template: { slug: string; category: string } | null = null,
  ) {}

  summary(userId: string): FeedbackSummary {
    const rules: FeedbackSummary["rules"] = {};
    const notHelpful: string[] = [];
    for (const [proposalId, feedback] of this.feedback) {
      if (this.owners.get(proposalId) !== userId) continue;
      const record = this.proposals.get(proposalId);
      if (!record?.rule_id) continue;
      const entry = (rules[record.rule_id] ??= { helpful: 0, not_helpful: 0 });
      if (feedback.helpful) entry.helpful += 1;
      else {
        entry.not_helpful += 1;
        if (record.fingerprint) notHelpful.push(record.fingerprint);
      }
    }
    return { hidden_rules: [...(this.hidden.get(userId) ?? [])].sort(), rules, not_helpful: notHelpful };
  }

  setFeedback(userId: string, proposalId: string, request: FeedbackRequest): AssistantFeedback {
    this.role(userId);
    const record = this.own(userId, proposalId);
    const reasons = request.helpful ? [] : [...new Set(request.reasons ?? [])].sort();
    if (request.helpful && (request.reasons ?? []).length > 0) throw new AppError("VALIDATION_FAILED");
    const feedback: AssistantFeedback = { helpful: request.helpful, reasons };
    this.feedback.set(proposalId, feedback);
    this.events.push(`feedback_set ${proposalId}`);
    if (request.hideRule && record.rule_id) this.setRuleHidden(userId, record.rule_id, true);
    return feedback;
  }

  clearFeedback(userId: string, proposalId: string): void {
    this.role(userId);
    this.own(userId, proposalId);
    if (this.feedback.delete(proposalId)) this.events.push(`feedback_removed ${proposalId}`);
  }

  setRuleHidden(userId: string, ruleId: string, hidden: boolean): void {
    this.role(userId);
    const set = this.hidden.get(userId) ?? new Set<string>();
    if (hidden && !set.has(ruleId)) this.events.push(`rule_hidden ${ruleId}`);
    if (!hidden && set.has(ruleId)) this.events.push(`rule_unhidden ${ruleId}`);
    if (hidden) set.add(ruleId);
    else set.delete(ruleId);
    this.hidden.set(userId, set);
  }

  private role(userId: string): BoardRole {
    const role = this.roleOf(userId);
    if (!role) throw new AppError("BOARD_NOT_FOUND");
    return role;
  }

  run(userId: string, request: AssistantRunRequest): AssistantRunResult {
    const role = this.role(userId);
    if (role === "VIEWER" && request.action === "propose_plan") throw new AppError("BOARD_ACCESS_DENIED");
    const objects = [...this.board.objects.values()].filter((object) => !object.deleted);
    if (
      request.context.kind === "object" &&
      !objects.some((o) => o.id === (request.context as { objectId: string }).objectId)
    ) {
      throw new AppError("OBJECT_NOT_FOUND");
    }
    const result = analyze({
      action: request.action,
      objects,
      comments: [],
      context: request.context,
      guidance: request.guidance,
      feedback: this.summary(userId),
      template: templateContextFor(this.template),
      focus: request.focus,
    });
    for (const [id, record] of this.proposals) {
      if (this.owners.get(id) === userId && record.status === "pending") {
        this.proposals.set(id, { ...record, status: "expired", resolved_at: new Date(0).toISOString() });
      }
    }
    const created = result.findings.map((finding): AssistantProposalRecord => {
      this.counter += 1;
      const id = `proposal-${this.counter}`;
      const record: AssistantProposalRecord = {
        id,
        board_id: this.boardId,
        context_kind: request.context.kind,
        context_object_id: request.context.kind === "object" ? request.context.objectId : null,
        action: request.action,
        guidance: request.guidance ?? null,
        status: "pending",
        rule_id: finding.rule_id,
        title: finding.title,
        explanation: finding.explanation,
        label: finding.label,
        severity: finding.severity,
        confidence: finding.confidence,
        usefulness: finding.usefulness,
        fingerprint: finding.fingerprint,
        evidence: finding.evidence,
        proposal: finding.proposal,
        edited_proposal: null,
        target_object_id: finding.target_object_id,
        target_object_version: finding.target_object_version,
        created_at: new Date(0).toISOString(),
        resolved_at: null,
        applied_operation_id: null,
      };
      this.proposals.set(id, record);
      this.owners.set(id, userId);
      this.events.push(`created ${id}`);
      return record;
    });
    return {
      proposals: created,
      exclusions: result.exclusions,
      guidanceIgnored: result.guidanceIgnored,
      truncated: result.truncated,
      suppressed: result.suppressed,
      template: result.template,
      focus: result.focus,
      clarity: result.clarity,
    };
  }

  list(userId: string): AssistantProposalRecord[] {
    this.role(userId);
    return [...this.proposals.values()]
      .filter((record) => this.owners.get(record.id) === userId)
      .map((record) => ({ ...record, feedback: this.feedback.get(record.id) ?? null }));
  }

  private own(userId: string, proposalId: string): AssistantProposalRecord {
    const record = this.proposals.get(proposalId);
    if (!record || this.owners.get(proposalId) !== userId) throw new AppError("PROPOSAL_NOT_FOUND");
    return record;
  }

  edit(userId: string, proposalId: string, proposal: ProposalDraft): AssistantProposalRecord {
    if (this.role(userId) === "VIEWER") throw new AppError("BOARD_ACCESS_DENIED");
    const record = this.own(userId, proposalId);
    if (record.status !== "pending") throw new AppError("PROPOSAL_NOT_PENDING");
    const next = { ...record, edited_proposal: proposal };
    this.proposals.set(proposalId, next);
    this.events.push(`edited ${proposalId}`);
    return next;
  }

  reject(userId: string, proposalId: string): AssistantProposalRecord {
    if (this.role(userId) === "VIEWER") throw new AppError("BOARD_ACCESS_DENIED");
    const record = this.own(userId, proposalId);
    if (record.status !== "pending" && record.status !== "stale") throw new AppError("PROPOSAL_NOT_PENDING");
    const next: AssistantProposalRecord = { ...record, status: "rejected", resolved_at: new Date(0).toISOString() };
    this.proposals.set(proposalId, next);
    this.events.push(`rejected ${proposalId}`);
    return next;
  }

  private staleReason(record: AssistantProposalRecord): StaleReason | null {
    const refs = record.evidence.map((e) => ({ id: e.object_id, version: e.version }));
    if (record.target_object_id && record.target_object_version != null) {
      refs.push({ id: record.target_object_id, version: record.target_object_version });
    }
    for (const ref of refs) {
      const live: CanvasObject | undefined = this.board.objects.get(ref.id);
      if (!live || live.deleted) return { object_id: ref.id, reason: "deleted" };
      if (live.version !== ref.version) return { object_id: ref.id, reason: "changed" };
    }
    return null;
  }

  accept(userId: string, proposalId: string): AssistantAcceptResult {
    const role = this.role(userId);
    if (role === "VIEWER") throw new AppError("BOARD_ACCESS_DENIED");
    const record = this.own(userId, proposalId);
    // Derived from the proposal id, like the database does, so a retry can never create a second object.
    const suffix = proposalId.replace(/\D/g, "").padStart(12, "0");
    const operationId = `00000000-0000-4000-a000-${suffix}`;
    const objectId = `00000000-0000-4000-a001-${suffix}`;

    if (record.status === "accepted" || record.status === "edited_accepted") {
      const existing = this.board.log.find((operation) => operation.operation_id === operationId);
      if (existing) return { status: "already_applied", proposal: record, operation: existing };
    }
    if (record.status === "rejected" || record.status === "expired") return { status: record.status, proposal: record };
    if (record.status === "stale") return { status: "stale", proposal: record };

    const reason = this.staleReason(record);
    if (reason) {
      const next: AssistantProposalRecord = { ...record, status: "stale", resolved_at: new Date(0).toISOString() };
      this.proposals.set(proposalId, next);
      this.events.push(`stale ${proposalId}`);
      return { status: "stale", proposal: next, reason };
    }

    const draft = record.edited_proposal ?? record.proposal;
    if (!draft) throw new AppError("PROPOSAL_NOT_FOUND");
    const result = this.board.apply(userId, {
      operation_id: operationId,
      type: "OBJECT_CREATED",
      object_id: objectId,
      payload: { ...draft.object, rotation: 0 },
      expected_version: null,
      client_timestamp: new Date(0).toISOString(),
    });
    if (result.status === "conflict") {
      this.events.push(`apply_failed ${proposalId}`);
      return { status: "failed", proposal: record, code: result.code };
    }
    const operation: ServerOperation = this.board.log.find((entry) => entry.operation_id === operationId)!;
    const accepted: AssistantProposalRecord = {
      ...record,
      status: record.edited_proposal ? "edited_accepted" : "accepted",
      resolved_at: new Date(0).toISOString(),
      applied_operation_id: operationId,
    };
    this.proposals.set(proposalId, accepted);
    this.events.push(`accepted ${proposalId}`, `applied ${proposalId}`);
    return { status: "applied", proposal: accepted, operation };
  }

  /** The service the board UI sees, for one signed-in user. */
  servicesFor(userId: string): AssistantServices {
    return {
      run: async (request) => this.run(userId, request),
      list: async () => this.list(userId),
      markViewed: async (proposalId) => {
        this.own(userId, proposalId);
        this.events.push(`viewed ${proposalId}`);
      },
      edit: async (proposalId, proposal) => this.edit(userId, proposalId, proposal),
      reject: async (proposalId) => this.reject(userId, proposalId),
      accept: async (proposalId) => this.accept(userId, proposalId),
      setFeedback: async (proposalId, feedback) => this.setFeedback(userId, proposalId, feedback),
      clearFeedback: async (proposalId) => this.clearFeedback(userId, proposalId),
      setRuleHidden: async (ruleId, hidden) => this.setRuleHidden(userId, ruleId, hidden),
      hiddenRules: async () => [...(this.hidden.get(userId) ?? [])].sort(),
    };
  }
}
