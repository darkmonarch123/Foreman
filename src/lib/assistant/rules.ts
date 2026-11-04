import type { CanvasObject } from "@/lib/board/types";
import {
  evidenceOf,
  findThemes,
  hasActionVerb,
  hasOwnerWording,
  isAttachedToArrow,
  questionKind,
  readingOrder,
  stripQuestion,
  tokenSetsSimilarity,
  type Ctx,
  type Note,
} from "./context";
import { NEAR_GAP, OVERLAP_TOLERANCE, boxOf, contains, gapBetween, overlapSize } from "./geometry";
import { excerpt, normalizeText, round2 } from "./text";
import type { EvidenceRef, FindingLabel, RuleId, Severity } from "./types";

/**
 * The eight v1 rules. Each is a pure function from board data to raw
 * findings; none of them reads anything else. Placement of the proposed note
 * and the final ranking happen afterwards in `analyze`.
 */

export interface RawFinding {
  rule_id: RuleId;
  title: string;
  explanation: string;
  label: FindingLabel;
  severity: Severity;
  confidence: number;
  evidence: EvidenceRef[];
  /** Text of the sticky note to propose, or null when the rule only reports. */
  proposalText: string | null;
  /** The existing object the proposed note is placed beside. */
  anchorId: string;
}

export type Rule = (ctx: Ctx) => RawFinding[];

const PAIR_LIMIT = 600;
const DUPLICATE_THRESHOLD = 0.72;
const VAGUE_MIN_LENGTH = 12;
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "tbd",
  "todo",
  "later",
  "maybe",
  "stuff",
  "things",
  "idea",
  "misc",
  "notes",
  "question",
]);

/** Notes with real, user-written content that the text rules may judge. */
function userNotes(ctx: Ctx): Note[] {
  return ctx.notes.filter((note) => !note.empty && !note.assistant);
}

function isNextStep(note: Note): boolean {
  return (
    /^(?:decide|mitigate|next step|owner needed)\b/.test(note.norm) ||
    (questionKind(note.text) === null && hasActionVerb(note.text))
  );
}

// -- 1. unanswered_question ---------------------------------------------------

export const unansweredQuestion: Rule = (ctx) => {
  const existing = new Set(ctx.notes.filter((note) => note.assistant).map((note) => note.norm));
  const findings: RawFinding[] = [];
  for (const note of userNotes(ctx)) {
    const kind = questionKind(note.text);
    if (!kind) continue;
    const question = stripQuestion(note.text);
    if (normalizeText(question).replace(/\?/g, "").length === 0) continue;
    const proposalText = `Decide: ${excerpt(question, 150)}`;
    if (existing.has(normalizeText(proposalText))) continue;
    findings.push({
      rule_id: "unanswered_question",
      title: "Unanswered question",
      explanation:
        kind === "explicit"
          ? "This note is a question, and no matching “Decide” note exists on the board."
          : "This note starts like a question, and no matching “Decide” note exists on the board.",
      label: "inference",
      severity: kind === "explicit" ? "high" : "warning",
      confidence: kind === "explicit" ? 0.8 : 0.6,
      evidence: [evidenceOf(note.object)],
      proposalText,
      anchorId: note.object.id,
    });
  }
  return findings;
};

// -- 2. action_without_owner --------------------------------------------------

export const actionWithoutOwner: Rule = (ctx) => {
  const findings: RawFinding[] = [];
  for (const note of userNotes(ctx)) {
    // A question is handled by the question rules.
    if (questionKind(note.text) !== null) continue;
    if (!hasActionVerb(note.text) || hasOwnerWording(note.text)) continue;
    findings.push({
      rule_id: "action_without_owner",
      title: "Action without an owner",
      explanation: "This note describes work but does not name an owner (no @mention, “owner” or “responsible”).",
      label: "inference",
      severity: "warning",
      confidence: 0.7,
      evidence: [evidenceOf(note.object)],
      proposalText: `Owner needed: ${excerpt(note.text, 60)}`,
      anchorId: note.object.id,
    });
  }
  return findings;
};

// -- 3. vague_note ------------------------------------------------------------

export const vagueNote: Rule = (ctx) => {
  const findings: RawFinding[] = [];
  for (const note of ctx.notes) {
    if (note.assistant) continue;
    const words = note.norm.replace(/\?/g, " ").split(" ").filter(Boolean);
    const generic = words.length > 0 && words.every((word) => GENERIC_WORDS.has(word));
    const short = note.norm.replace(/\?/g, "").trim().length < VAGUE_MIN_LENGTH;
    if (!note.empty && !generic && !short) continue;
    findings.push({
      rule_id: "vague_note",
      title: note.empty ? "Empty note" : "Vague note",
      explanation: note.empty
        ? "This note has no text."
        : "This note is very short or only uses generic words, so its outcome is unclear.",
      label: "inference",
      severity: note.empty ? "warning" : "info",
      confidence: note.empty ? 0.8 : 0.55,
      evidence: [evidenceOf(note.object)],
      proposalText: note.empty
        ? "Clarify: What should this empty note say?"
        : `Clarify: What is the outcome, owner, or next step for “${excerpt(note.text, 40)}”?`,
      anchorId: note.object.id,
    });
  }
  return findings;
};

// -- 4. possible_duplicate ----------------------------------------------------

export const possibleDuplicate: Rule = (ctx) => {
  const notes = userNotes(ctx).slice(0, PAIR_LIMIT);
  const parent = notes.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const edges: { i: number; similarity: number }[] = [];
  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const similarity = tokenSetsSimilarity(notes[i], notes[j]);
      if (similarity < DUPLICATE_THRESHOLD) continue;
      parent[find(j)] = find(i);
      edges.push({ i, similarity });
    }
  }
  // A group's confidence is its strongest pair.
  const best = new Map<number, number>();
  for (const edge of edges) {
    const root = find(edge.i);
    best.set(root, Math.max(best.get(root) ?? 0, edge.similarity));
  }
  const groups = new Map<number, Note[]>();
  notes.forEach((note, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), note]);
  });
  const findings: RawFinding[] = [];
  for (const [root, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => readingOrder(a.object, b.object));
    findings.push({
      rule_id: "possible_duplicate",
      title: "Possible duplicate notes",
      explanation: `${ordered.length} notes use almost the same words. They may describe the same item.`,
      label: "inference",
      severity: "info",
      confidence: round2(Math.min(0.9, best.get(root) ?? DUPLICATE_THRESHOLD)),
      evidence: ordered.slice(0, 5).map((note) => evidenceOf(note.object)),
      proposalText: "Merge review: Confirm whether these notes describe the same item.",
      anchorId: ordered[0].object.id,
    });
  }
  return findings;
};

// -- 5. disconnected_object ---------------------------------------------------

export const disconnectedObject: Rule = (ctx) => {
  const findings: RawFinding[] = [];
  for (const object of ctx.objects) {
    if (object.type === "ARROW" || object.type === "DRAWING") continue;
    // Notes the Assistant added sit beside their source on purpose.
    if (ctx.notes.some((note) => note.object.id === object.id && note.assistant)) continue;
    if (ctx.commentedIds.has(object.id) || isAttachedToArrow(ctx, object)) continue;
    findings.push({
      rule_id: "disconnected_object",
      title: "Not connected to anything",
      explanation: "No arrow touches this item and no comment is attached to it.",
      label: "fact",
      severity: "info",
      confidence: 0.9,
      evidence: [evidenceOf(object)],
      proposalText: "Connect: Explain how this item relates to the plan.",
      anchorId: object.id,
    });
  }
  return findings;
};

// -- 6. overlapping_objects ---------------------------------------------------

function isFrameAround(outer: CanvasObject, inner: CanvasObject): boolean {
  if (outer.type !== "RECTANGLE" && outer.type !== "CIRCLE") return false;
  const a = boxOf(outer);
  const b = boxOf(inner);
  return contains(a, b) && a.width * a.height > b.width * b.height;
}

export const overlappingObjects: Rule = (ctx) => {
  const items: CanvasObject[] = ctx.objects
    .filter((object) => object.type !== "ARROW" && object.type !== "DRAWING")
    .slice(0, PAIR_LIMIT);
  const findings: RawFinding[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const overlap = overlapSize(boxOf(items[i]), boxOf(items[j]));
      if (overlap.width <= OVERLAP_TOLERANCE || overlap.height <= OVERLAP_TOLERANCE) continue;
      // A note sitting inside a frame is deliberate grouping.
      if (isFrameAround(items[i], items[j]) || isFrameAround(items[j], items[i])) continue;
      const [first, second] = [items[i], items[j]].sort(readingOrder);
      findings.push({
        rule_id: "overlapping_objects",
        title: "Items overlap",
        explanation: `These two items overlap by ${Math.round(overlap.width)} × ${Math.round(overlap.height)} px, which can hide text.`,
        label: "fact",
        severity: "info",
        confidence: 0.9,
        evidence: [evidenceOf(first), evidenceOf(second)],
        proposalText: "Separate: These items overlap. Move them apart or group them on purpose.",
        anchorId: first.id,
      });
    }
  }
  return findings;
};

// -- 7. theme_without_decision ------------------------------------------------

export const themeWithoutDecision: Rule = (ctx) => {
  const decisions = ctx.notes.filter((note) => /^(?:decide|mitigate)\b/.test(note.norm));
  const findings: RawFinding[] = [];
  for (const theme of findThemes(ctx.notes).slice(0, 3)) {
    const covered = decisions.some(
      (decision) =>
        theme.keywords.some((keyword) => decision.tokenSet.has(keyword)) ||
        theme.notes.some((note) => gapBetween(note.box, decision.box) <= NEAR_GAP),
    );
    if (covered) continue;
    const keywords = theme.keywords.slice(0, 3);
    findings.push({
      rule_id: "theme_without_decision",
      title: `Theme without a decision: ${keywords.join(", ")}`,
      explanation: `${theme.notes.length} notes share these words, and no “Decide” or “Mitigate” note covers them.`,
      label: "suggestion",
      severity: "warning",
      confidence: 0.6,
      evidence: theme.notes.slice(0, 5).map((note) => evidenceOf(note.object)),
      proposalText: `Decide: Settle the approach for ${keywords.join(", ")}`,
      anchorId: theme.notes[0].object.id,
    });
  }
  return findings;
};

// -- 8. open_question_without_next_step ---------------------------------------

export const openQuestionWithoutNextStep: Rule = (ctx) => {
  const steps = ctx.notes.filter((note) => !note.empty && isNextStep(note));
  const alreadyReported = new Set(
    unansweredQuestion(ctx).flatMap((finding) => finding.evidence.map((item) => item.object_id)),
  );
  const findings: RawFinding[] = [];
  for (const note of userNotes(ctx)) {
    if (questionKind(note.text) === null) continue;
    // Rule 1 already asks for a decision on this question; a second card would repeat it.
    if (alreadyReported.has(note.object.id)) continue;
    if (steps.some((step) => step.object.id !== note.object.id && gapBetween(note.box, step.box) <= NEAR_GAP)) continue;
    findings.push({
      rule_id: "open_question_without_next_step",
      title: "Question without a next step",
      explanation: "No decision, action or mitigation note is near this question.",
      label: "suggestion",
      severity: "warning",
      confidence: 0.65,
      evidence: [evidenceOf(note.object)],
      proposalText: `Next step: ${excerpt(stripQuestion(note.text), 150)}`,
      anchorId: note.object.id,
    });
  }
  return findings;
};

export const RULES: Record<RuleId, Rule> = {
  unanswered_question: unansweredQuestion,
  action_without_owner: actionWithoutOwner,
  vague_note: vagueNote,
  possible_duplicate: possibleDuplicate,
  disconnected_object: disconnectedObject,
  overlapping_objects: overlappingObjects,
  theme_without_decision: themeWithoutDecision,
  open_question_without_next_step: openQuestionWithoutNextStep,
};
