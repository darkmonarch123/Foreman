import type { CanvasObject } from "@/lib/board/types";
import type { RawFinding } from "./rules";
import { templateRelevance } from "./template-context";
import type { AssistantTemplateContext, EvidenceRef, FeedbackSummary, RuleId, Severity } from "./types";

/**
 * Foreman Assistant v1.1: what to show, in what order.
 *
 *   usefulness = confidence × severityWeight × actionabilityWeight × freshnessWeight × templateRelevanceWeight
 *
 * Before scoring, findings are suppressed (types the person hid on this board, and findings
 * they marked not helpful), merged (two rules about exactly the same items become one card)
 * and combined (three or more report-only findings of one kind become one card). Everything
 * here is deterministic and reads only ids, versions, timestamps, rule ids and scores, never
 * note text.
 */

export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 1, warning: 0.85, info: 0.7 };

/** A finding that proposes a concrete change is worth more than one that only reports. */
export const ACTIONABILITY_WEIGHT = { proposal: 1, report: 0.8 } as const;

const DAY = 24 * 60 * 60 * 1000;

/** Recently edited items are what people are working on now. Unknown times count as a week old. */
export function freshnessWeight(
  evidence: readonly EvidenceRef[],
  byId: ReadonlyMap<string, CanvasObject>,
  now: number,
) {
  let newest = Number.NEGATIVE_INFINITY;
  for (const item of evidence) {
    const at = Date.parse(byId.get(item.object_id)?.updated_at ?? "");
    if (Number.isFinite(at)) newest = Math.max(newest, at);
  }
  if (!Number.isFinite(newest)) return 0.9;
  const age = now - newest;
  if (age <= DAY) return 1;
  if (age <= 7 * DAY) return 0.9;
  if (age <= 30 * DAY) return 0.8;
  return 0.7;
}

/**
 * The person's own votes on this kind of finding, on this board: each "helpful" adds 10%,
 * each "not helpful" takes away 15%, within 0.4–1.2. Applied to the template relevance.
 */
export function feedbackWeight(feedback: FeedbackSummary | null | undefined, rule: RuleId): number {
  const votes = feedback?.rules?.[rule];
  if (!votes) return 1;
  return Math.min(1.2, Math.max(0.4, 1 + 0.1 * votes.helpful - 0.15 * votes.not_helpful));
}

export function fingerprintOf(rule: RuleId, evidence: readonly EvidenceRef[]): string {
  return `${rule}:${[...new Set(evidence.map((item) => item.object_id))].sort().join(",")}`;
}

export interface ScoredFinding extends RawFinding {
  usefulness: number;
  fingerprint: string;
}

const SEVERITY_ORDER: Severity[] = ["info", "warning", "high"];

const COMBINED_TITLES: Partial<Record<RuleId, (count: number) => string>> = {
  vague_note: (count) => `${count} notes could be clearer`,
  overlapping_objects: (count) => `${count} pairs of items overlap`,
  disconnected_object: (count) => `${count} items are not connected to anything`,
  possible_duplicate: (count) => `${count} groups of notes look alike`,
};

/** How many report-only findings of one kind it takes to combine them into one card. */
export const COMBINE_AT = 3;
const MAX_EVIDENCE = 10;

function evidenceKey(raw: RawFinding): string {
  return [...new Set(raw.evidence.map((item) => item.object_id))].sort().join(",");
}

export interface RankOptions {
  byId: ReadonlyMap<string, CanvasObject>;
  feedback?: FeedbackSummary | null;
  template?: AssistantTemplateContext | null;
  now: number;
}

export function score(raw: RawFinding, options: RankOptions): number {
  const value =
    raw.confidence *
    SEVERITY_WEIGHT[raw.severity] *
    (raw.proposalText ? ACTIONABILITY_WEIGHT.proposal : ACTIONABILITY_WEIGHT.report) *
    freshnessWeight(raw.evidence, options.byId, options.now) *
    templateRelevance(options.template, raw.rule_id) *
    feedbackWeight(options.feedback, raw.rule_id);
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}

/** Leaves out what the person asked not to see. Returns the kept findings and how many were left out. */
export function suppress(raws: RawFinding[], feedback: FeedbackSummary | null | undefined) {
  if (!feedback) return { kept: raws, suppressed: 0 };
  const hidden = new Set(feedback.hidden_rules ?? []);
  const notHelpful = new Set(feedback.not_helpful ?? []);
  const kept = raws.filter(
    (raw) => !hidden.has(raw.rule_id) && !notHelpful.has(fingerprintOf(raw.rule_id, raw.evidence)),
  );
  return { kept, suppressed: raws.length - kept.length };
}

/**
 * Two findings about exactly the same items (for example "unanswered question" and "open
 * question without a next step" on one note) become one: the more useful one is kept and
 * mentions the other.
 */
export function merge(raws: RawFinding[], options: RankOptions): RawFinding[] {
  const groups = new Map<string, RawFinding[]>();
  for (const raw of raws) {
    const key = evidenceKey(raw);
    groups.set(key, [...(groups.get(key) ?? []), raw]);
  }
  const out: RawFinding[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => score(b, options) - score(a, options));
    const [best, ...rest] = sorted;
    const also = rest.map((raw) => raw.title).join("; ");
    out.push({
      ...best,
      explanation: `${best.explanation} Also: ${also}.`.slice(0, 500),
      confidence: Math.max(...group.map((raw) => raw.confidence)),
      severity: SEVERITY_ORDER[Math.max(...group.map((raw) => SEVERITY_ORDER.indexOf(raw.severity)))],
    });
  }
  return out;
}

/** Three or more report-only findings of one kind become one card with all their evidence. */
export function combine(raws: RawFinding[]): RawFinding[] {
  const byRule = new Map<RuleId, RawFinding[]>();
  const out: RawFinding[] = [];
  for (const raw of raws) {
    if (raw.proposalText) {
      out.push(raw);
      continue;
    }
    byRule.set(raw.rule_id, [...(byRule.get(raw.rule_id) ?? []), raw]);
  }
  for (const [rule, group] of byRule) {
    if (group.length < COMBINE_AT) {
      out.push(...group);
      continue;
    }
    const evidence: EvidenceRef[] = [];
    const seen = new Set<string>();
    for (const item of group.flatMap((raw) => raw.evidence)) {
      if (seen.has(item.object_id) || evidence.length >= MAX_EVIDENCE) continue;
      seen.add(item.object_id);
      evidence.push(item);
    }
    const first = group[0];
    out.push({
      ...first,
      title: (COMBINED_TITLES[rule] ?? ((count: number) => `${count} similar findings`))(group.length).slice(0, 120),
      explanation: `${first.explanation} The same applies to ${group.length - 1} more.`.slice(0, 500),
      confidence: Math.max(...group.map((raw) => raw.confidence)),
      severity: SEVERITY_ORDER[Math.max(...group.map((raw) => SEVERITY_ORDER.indexOf(raw.severity)))],
      evidence,
    });
  }
  return out;
}

/** Suppress, merge, combine, score and sort. Ties keep the v1 order (confidence, rule, evidence). */
export function rankFindings(
  raws: RawFinding[],
  options: RankOptions,
  tieBreak: (a: RawFinding, b: RawFinding) => number,
): { ranked: ScoredFinding[]; suppressed: number } {
  const { kept, suppressed } = suppress(raws, options.feedback);
  const ranked = combine(merge(kept, options))
    .map((raw) => ({ ...raw, usefulness: score(raw, options), fingerprint: fingerprintOf(raw.rule_id, raw.evidence) }))
    .sort((a, b) => b.usefulness - a.usefulness || tieBreak(a, b));
  return { ranked, suppressed };
}
