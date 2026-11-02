import { defaultPayload } from "@/lib/board/defaults";
import { buildCtx, readingOrder, type Ctx } from "./context";
import { explainBoard, explainObject } from "./explain";
import { boxOf, findFreeSpot, type Box } from "./geometry";
import { mentionsAny, parseGuidance } from "./guidance";
import { RULES, type RawFinding } from "./rules";
import { round2 } from "./text";
import {
  MAX_FINDINGS,
  MAX_PROPOSAL_TEXT,
  MIN_CONFIDENCE,
  RULE_IDS,
  type AnalysisInput,
  type AnalysisResult,
  type AssistantAction,
  type Finding,
  type ProposalDraft,
  type RuleId,
} from "./types";

/** Fill for notes the Assistant proposes: lavender, so they read as suggestions. */
const ASSISTANT_NOTE_FILL = "#AEB9F4";

/**
 * Rules per action. "Find planning gaps" reports what is missing or messy;
 * "Propose a plan" runs every rule, including the theme rule that suggests
 * decisions the board does not mention yet.
 */
const RULES_FOR: Record<Exclude<AssistantAction, "explain_board">, readonly RuleId[]> = {
  find_planning_gaps: RULE_IDS.filter((id) => id !== "theme_without_decision"),
  propose_plan: RULE_IDS,
};

function proposalFor(text: string, spot: { x: number; y: number }): ProposalDraft {
  const base = defaultPayload("STICKY_NOTE", { x: 0, y: 0 });
  return {
    kind: "create_object",
    object: {
      type: "STICKY_NOTE",
      x: spot.x,
      y: spot.y,
      width: base.width,
      height: base.height,
      props: { ...base.props, text: text.slice(0, MAX_PROPOSAL_TEXT), fill: ASSISTANT_NOTE_FILL },
    },
  };
}

function finalize(raws: RawFinding[], ctx: Ctx): Finding[] {
  const occupied: Box[] = [...ctx.occupied];
  return raws.map((raw) => {
    const anchor = ctx.byId.get(raw.anchorId);
    let proposal: ProposalDraft | null = null;
    if (raw.proposalText && anchor) {
      const size = proposalFor("", { x: 0, y: 0 }).object;
      const spot = findFreeSpot(boxOf(anchor), { width: size.width, height: size.height }, occupied);
      occupied.push({ x: spot.x, y: spot.y, width: size.width, height: size.height });
      proposal = proposalFor(raw.proposalText, spot);
    }
    return {
      rule_id: raw.rule_id,
      title: raw.title,
      explanation: raw.explanation,
      label: raw.label,
      severity: raw.severity,
      confidence: round2(raw.confidence),
      evidence: raw.evidence,
      proposal,
      target_object_id: proposal ? (raw.evidence[0]?.object_id ?? null) : null,
      target_object_version: proposal ? (raw.evidence[0]?.version ?? null) : null,
    };
  });
}

function rank(a: RawFinding, b: RawFinding): number {
  return (
    b.confidence - a.confidence ||
    RULE_IDS.indexOf(a.rule_id) - RULE_IDS.indexOf(b.rule_id) ||
    a.evidence
      .map((item) => item.object_id)
      .join()
      .localeCompare(b.evidence.map((item) => item.object_id).join())
  );
}

/**
 * Runs the Assistant. Pure and synchronous: the same board always gives the
 * same result, and user text is only compared and excerpted, never evaluated.
 */
export function analyze(input: AnalysisInput): AnalysisResult {
  const guidance = parseGuidance(input.guidance);
  const ctx = buildCtx(input.objects, input.comments, (note) => mentionsAny(note.text, guidance.terms));
  const result = (findings: Finding[], truncated = false): AnalysisResult => ({
    findings,
    exclusions: guidance.terms,
    guidanceIgnored: guidance.ignored,
    truncated,
  });

  const contextId = input.context.kind === "object" ? input.context.objectId : null;
  const inContext = (finding: { evidence: { object_id: string }[] }) =>
    contextId === null || finding.evidence.some((item) => item.object_id === contextId);

  if (input.action === "explain_board") {
    const rows =
      contextId === null
        ? explainBoard(ctx)
        : explainObject(ctx, contextId).concat(
            explainBoard(ctx).filter((row) => row.title !== "Board overview" && inContext(row)),
          );
    return result(rows);
  }

  const raws: RawFinding[] = [];
  const seen = new Set<string>();
  for (const id of RULES_FOR[input.action]) {
    for (const raw of RULES[id](ctx)) {
      const key = `${raw.rule_id}:${raw.evidence.map((item) => item.object_id).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (raw.confidence >= MIN_CONFIDENCE && inContext(raw)) raws.push(raw);
    }
  }
  raws.sort(rank);
  const top = raws.slice(0, MAX_FINDINGS);
  return result(finalize(top, ctx), raws.length > MAX_FINDINGS);
}

export { readingOrder };
