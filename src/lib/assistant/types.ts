import type { CanvasObject, CanvasProps, ServerOperation } from "@/lib/board/types";

/**
 * Foreman Assistant v1: shared types.
 *
 * The Assistant is a deterministic rule engine. Nothing here talks to a
 * network, a database or React, so the same code runs in the Server Action,
 * in the in-memory test backend and in unit tests.
 */

export const ASSISTANT_ACTIONS = ["explain_board", "find_planning_gaps", "propose_plan"] as const;
export type AssistantAction = (typeof ASSISTANT_ACTIONS)[number];

export const ASSISTANT_ACTION_LABELS: Record<AssistantAction, { label: string; description: string }> = {
  explain_board: { label: "Explain this board", description: "Summarize the content and key open questions." },
  find_planning_gaps: {
    label: "Find planning gaps",
    description: "Unanswered questions, missing owners, vague notes, and layout problems.",
  },
  propose_plan: { label: "Propose a plan", description: "Review suggested board changes before applying." },
};

export const FINDING_LABELS = ["fact", "inference", "suggestion"] as const;
export type FindingLabel = (typeof FINDING_LABELS)[number];

export const SEVERITIES = ["info", "warning", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RULE_IDS = [
  "unanswered_question",
  "action_without_owner",
  "vague_note",
  "possible_duplicate",
  "disconnected_object",
  "overlapping_objects",
  "theme_without_decision",
  "open_question_without_next_step",
  // v1.2: action extraction
  "extracted_decision",
  "extracted_owner",
  "extracted_risk",
  "extracted_next_step",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

/** Short names for each kind of finding, used when people hide or show a kind. */
export const RULE_LABELS: Record<RuleId, string> = {
  unanswered_question: "Unanswered questions",
  action_without_owner: "Actions without an owner",
  vague_note: "Vague notes",
  possible_duplicate: "Possible duplicates",
  disconnected_object: "Unconnected items",
  overlapping_objects: "Overlapping items",
  theme_without_decision: "Themes without a decision",
  open_question_without_next_step: "Questions without a next step",
  extracted_decision: "Decisions to record",
  extracted_owner: "Owners to record",
  extracted_risk: "Risks to record",
  extracted_next_step: "Next steps to record",
};

/** v1.2 follow-up: "What should Assistant focus on?" */
export const ASSISTANT_FOCUSES = ["everything", "decisions", "owners", "risks", "next_steps"] as const;
export type AssistantFocus = (typeof ASSISTANT_FOCUSES)[number];

export const FOCUS_LABELS: Record<AssistantFocus, string> = {
  everything: "Everything",
  decisions: "Decisions",
  owners: "Owners",
  risks: "Risks",
  next_steps: "Next steps",
};

/** Which kinds of finding each focus keeps. "Everything" keeps all of them. */
export const FOCUS_RULES: Record<Exclude<AssistantFocus, "everything">, readonly RuleId[]> = {
  decisions: ["unanswered_question", "theme_without_decision", "extracted_decision"],
  owners: ["action_without_owner", "extracted_owner"],
  risks: ["extracted_risk", "theme_without_decision"],
  next_steps: ["open_question_without_next_step", "extracted_next_step", "vague_note"],
};

/** Planning clarity: how ready the board is to act on, 0–100. */
export interface PlanningClarity {
  score: number;
  /** Each part, 0–1, with how much it counts towards the score. */
  parts: {
    id: "decisions" | "owners" | "next_steps" | "clarity" | "structure";
    label: string;
    value: number;
    weight: number;
  }[];
  strengths: string[];
  gaps: string[];
  improvements: string[];
}

/** Object types the Assistant may ask to create. Drawings are never proposed. */
export const PROPOSAL_OBJECT_TYPES = ["STICKY_NOTE", "TEXT", "RECTANGLE", "CIRCLE", "ARROW"] as const;
export type ProposalObjectType = (typeof PROPOSAL_OBJECT_TYPES)[number];

export const PROPOSAL_STATUSES = ["pending", "accepted", "edited_accepted", "rejected", "stale", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Minimum confidence a finding needs to be reported. */
export const MIN_CONFIDENCE = 0.5;
/** The most findings one run returns. */
export const MAX_FINDINGS = 10;
/** How many findings the panel shows before "Show more findings". */
export const DEFAULT_VISIBLE_FINDINGS = 5;
/** Longest proposed note text. Matches what the database accepts. */
export const MAX_PROPOSAL_TEXT = 200;
/** Longest stored excerpt of user content. */
export const MAX_EXCERPT = 80;
/** Longest optional guidance. */
export const MAX_GUIDANCE = 300;

/** What the person is pointed at when they click "View". Never the full note body. */
export interface EvidenceRef {
  object_id: string;
  /** The object's version when the finding was produced. */
  version: number;
  /** A short, whitespace-collapsed excerpt of the object's text, or its type if it has none. */
  excerpt: string;
}

/**
 * The only change v1 can propose: add one new object. There are no update or
 * delete proposals, so accepting one can never overwrite or remove anyone's work.
 */
export interface ProposalDraft {
  kind: "create_object";
  object: {
    type: ProposalObjectType;
    x: number;
    y: number;
    width: number;
    height: number;
    props: CanvasProps;
  };
}

export interface Finding {
  /** Null for the descriptive rows produced by "Explain this board". */
  rule_id: RuleId | null;
  title: string;
  explanation: string;
  label: FindingLabel;
  severity: Severity;
  /** 0..1, two decimal places. */
  confidence: number;
  evidence: EvidenceRef[];
  proposal: ProposalDraft | null;
  /** The existing object the proposal is about, if any. Used for stale detection. */
  target_object_id: string | null;
  target_object_version: number | null;
  /** 0..1: how useful this is likely to be, used to rank (see rank.ts). Null for Explain rows. */
  usefulness: number | null;
  /** Rule id and sorted evidence ids. Identifies "the same finding" across runs; never contains text. */
  fingerprint: string | null;
}

export const FEEDBACK_REASONS = ["irrelevant", "duplicate", "wrong_evidence", "too_obvious", "wrong_action"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  irrelevant: "Irrelevant",
  duplicate: "Duplicate",
  wrong_evidence: "Wrong evidence",
  too_obvious: "Too obvious",
  wrong_action: "Wrong suggested action",
};

/** The caller's own feedback on one finding. */
export interface AssistantFeedback {
  helpful: boolean;
  reasons: FeedbackReason[];
  updated_at?: string;
}

/** The caller's feedback on a board, summarised for ranking. Never includes anyone else's. */
export interface FeedbackSummary {
  hidden_rules: string[];
  rules: Record<string, { helpful: number; not_helpful: number }>;
  /** Fingerprints the caller marked not helpful. */
  not_helpful: string[];
}

/** What the Assistant knows about the template a board started from. */
export interface AssistantTemplateContext {
  templateId: string;
  category: "PLANNING" | "BRAINSTORMING" | "STUDY" | "PRODUCT" | "ENGINEERING";
  /** What a finished board of this kind should produce, in a few words. */
  outcome: string;
  /** Section headings the template starts with. */
  expectedSections: string[];
}

export type AnalysisContext = { kind: "board" } | { kind: "object"; objectId: string };

/** Only ids are needed from comments; their text is never read by the engine. */
export interface AnalysisComment {
  id: string;
  object_id: string | null;
}

export interface AnalysisInput {
  action: AssistantAction;
  objects: readonly CanvasObject[];
  comments: readonly AnalysisComment[];
  context: AnalysisContext;
  guidance?: string | null;
  /** The caller's feedback on this board (hidden rules, per-rule votes, findings marked not helpful). */
  feedback?: FeedbackSummary | null;
  template?: AssistantTemplateContext | null;
  /** Milliseconds since the epoch, for freshness. Defaults to Date.now(). */
  now?: number;
  /** v1.2: keep only the kinds of finding for one focus. Default "everything". */
  focus?: AssistantFocus;
  /**
   * False skips suppression, merging and combining and keeps the v1 order (confidence, rule,
   * evidence), so each rule can be tested on its own. Scores are still attached. Default true.
   */
  postprocess?: boolean;
}

export interface AnalysisResult {
  findings: Finding[];
  /** Terms the guidance asked to leave out, for display. */
  exclusions: string[];
  /** True when guidance was given but nothing in it could be applied. */
  guidanceIgnored: boolean;
  /** True when more than MAX_FINDINGS qualified and the lowest were dropped. */
  truncated: boolean;
  /** How many findings were left out because of the caller's feedback (hidden or marked not helpful). */
  suppressed: number;
  template: AssistantTemplateContext | null;
  focus: AssistantFocus;
  /** Null for an empty board. */
  clarity: PlanningClarity | null;
}

// ---------------------------------------------------------------------------
// Stored proposals and the service the board UI talks to
// ---------------------------------------------------------------------------

/** One stored finding, as returned by the database functions. */
export interface AssistantProposalRecord {
  id: string;
  board_id: string;
  context_kind: "board" | "object";
  context_object_id: string | null;
  action: AssistantAction;
  guidance: string | null;
  status: ProposalStatus;
  rule_id: RuleId | null;
  title: string;
  explanation: string;
  label: FindingLabel;
  severity: Severity;
  confidence: number;
  usefulness?: number | null;
  fingerprint?: string | null;
  /** The caller's own feedback, when listed. */
  feedback?: AssistantFeedback | null;
  evidence: EvidenceRef[];
  proposal: ProposalDraft | null;
  edited_proposal: ProposalDraft | null;
  target_object_id: string | null;
  target_object_version: number | null;
  created_at: string;
  resolved_at: string | null;
  applied_operation_id: string | null;
}

export interface AssistantRunRequest {
  action: AssistantAction;
  context: AnalysisContext;
  guidance?: string;
  focus?: AssistantFocus;
}

export interface AssistantRunResult {
  proposals: AssistantProposalRecord[];
  exclusions: string[];
  guidanceIgnored: boolean;
  truncated: boolean;
  suppressed?: number;
  template?: AssistantTemplateContext | null;
  focus?: AssistantFocus;
  clarity?: PlanningClarity | null;
}

export interface FeedbackRequest {
  helpful: boolean;
  reasons?: FeedbackReason[];
  hideRule?: boolean;
}

export type StaleReason = { object_id: string; reason: "changed" | "deleted" };

/** What happened when a proposal was accepted. Never an exception for an expected outcome. */
export type AssistantAcceptResult =
  | { status: "applied" | "already_applied"; proposal: AssistantProposalRecord; operation: ServerOperation }
  | { status: "stale"; proposal: AssistantProposalRecord; reason?: StaleReason }
  | { status: "rejected" | "expired"; proposal: AssistantProposalRecord }
  | { status: "failed"; proposal: AssistantProposalRecord; code: string };

/** The Assistant as the board UI sees it. Implemented over Server Actions and by the in-memory test backend. */
export interface AssistantServices {
  run(request: AssistantRunRequest): Promise<AssistantRunResult>;
  /** The caller's pending and stale proposals for this board. */
  list(): Promise<AssistantProposalRecord[]>;
  markViewed(proposalId: string): Promise<void>;
  edit(proposalId: string, proposal: ProposalDraft): Promise<AssistantProposalRecord>;
  reject(proposalId: string): Promise<AssistantProposalRecord>;
  accept(proposalId: string): Promise<AssistantAcceptResult>;
  /** Records or changes the caller's feedback on a finding. Changes ranking only. */
  setFeedback(proposalId: string, feedback: FeedbackRequest): Promise<AssistantFeedback>;
  clearFeedback(proposalId: string): Promise<void>;
  /** Shows (false) or hides (true) a type of finding on this board for the caller. */
  setRuleHidden(ruleId: string, hidden: boolean): Promise<void>;
  hiddenRules(): Promise<string[]>;
}
