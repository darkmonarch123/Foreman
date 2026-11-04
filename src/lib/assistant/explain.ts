import type { CanvasObjectType } from "@/lib/board/types";
import {
  describeObject,
  evidenceOf,
  findThemes,
  hasRiskWording,
  isAttachedToArrow,
  questionKind,
  readingOrder,
  type Ctx,
} from "./context";
import type { Finding } from "./types";

/**
 * "Explain this board": descriptive rows built from counts and keywords.
 * The stored explanation never contains note text; quotes live only in the
 * short evidence excerpts.
 */

const NAMES: Record<CanvasObjectType, [string, string]> = {
  STICKY_NOTE: ["sticky note", "sticky notes"],
  TEXT: ["text item", "text items"],
  RECTANGLE: ["rectangle", "rectangles"],
  CIRCLE: ["circle", "circles"],
  ARROW: ["arrow", "arrows"],
  DRAWING: ["drawing", "drawings"],
};

const MAX_EVIDENCE = 5;

function row(
  partial: Omit<
    Finding,
    "rule_id" | "proposal" | "target_object_id" | "target_object_version" | "usefulness" | "fingerprint"
  >,
): Finding {
  return {
    rule_id: null,
    proposal: null,
    target_object_id: null,
    target_object_version: null,
    usefulness: null,
    fingerprint: null,
    ...partial,
  };
}

export function explainBoard(ctx: Ctx): Finding[] {
  const ordered = [...ctx.objects].sort(readingOrder);
  if (ordered.length === 0) {
    return [
      row({
        title: "Nothing to analyze yet",
        explanation: "The board has no objects. Add a sticky note, text or a shape, then run the Assistant again.",
        label: "fact",
        severity: "info",
        confidence: 0.95,
        evidence: [],
      }),
    ];
  }

  const counts = new Map<CanvasObjectType, number>();
  for (const object of ordered) counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
  const breakdown = [...counts.entries()]
    .map(([type, count]) => `${count} ${NAMES[type][count === 1 ? 0 : 1]}`)
    .join(", ");
  const anchored = ctx.commentedIds.size;

  const rows: Finding[] = [
    row({
      title: "Board overview",
      explanation: `${ordered.length} ${ordered.length === 1 ? "object" : "objects"}: ${breakdown}.${
        anchored > 0 ? ` ${anchored} ${anchored === 1 ? "object has" : "objects have"} comments attached.` : ""
      }`,
      label: "fact",
      severity: "info",
      confidence: 0.95,
      evidence: ordered.slice(0, MAX_EVIDENCE).map(evidenceOf),
    }),
  ];

  const notes = ctx.notes.filter((note) => !note.empty && !note.assistant);
  if (notes.length < 2) {
    rows.push(
      row({
        title: "Too little content to analyze",
        explanation: "Fewer than two notes have text, so there are no themes, questions or risks to summarize yet.",
        label: "fact",
        severity: "info",
        confidence: 0.9,
        evidence: notes.map((note) => evidenceOf(note.object)),
      }),
    );
    return rows;
  }

  const themes = findThemes(ctx.notes).slice(0, 3);
  if (themes.length > 0) {
    rows.push(
      row({
        title: "Main themes",
        explanation: themes
          .map((theme) => `“${theme.keywords.slice(0, 3).join(", ")}” appears in ${theme.notes.length} notes`)
          .join("; ")
          .concat("."),
        label: "inference",
        severity: "info",
        confidence: 0.6,
        evidence: themes[0].notes.slice(0, MAX_EVIDENCE).map((note) => evidenceOf(note.object)),
      }),
    );
  }

  const questions = notes.filter((note) => questionKind(note.text) !== null);
  if (questions.length > 0) {
    rows.push(
      row({
        title: "Open questions",
        explanation: `${questions.length} ${questions.length === 1 ? "note is" : "notes are"} phrased as a question.`,
        label: "fact",
        severity: "warning",
        confidence: 0.9,
        evidence: questions.slice(0, MAX_EVIDENCE).map((note) => evidenceOf(note.object)),
      }),
    );
  }

  const risks = notes.filter((note) => hasRiskWording(note.text));
  if (risks.length > 0) {
    rows.push(
      row({
        title: "Possible risks or blockers",
        explanation: `${risks.length} ${risks.length === 1 ? "note uses" : "notes use"} words such as “risk”, “blocked” or “unclear”. This is a guess from wording only.`,
        label: "inference",
        severity: "warning",
        confidence: 0.6,
        evidence: risks.slice(0, MAX_EVIDENCE).map((note) => evidenceOf(note.object)),
      }),
    );
  }

  return rows;
}

/** A description of the one selected object: what it is, what it is attached to, and how it reads. */
export function explainObject(ctx: Ctx, objectId: string): Finding[] {
  const object = ctx.byId.get(objectId);
  if (!object) {
    return [
      row({
        title: "Selected object not found",
        explanation: "The selected object was deleted or is no longer available.",
        label: "fact",
        severity: "info",
        confidence: 0.95,
        evidence: [],
      }),
    ];
  }
  const connected = isAttachedToArrow(ctx, object);
  const commented = ctx.commentedIds.has(object.id);
  const note = ctx.notes.find((entry) => entry.object.id === object.id);
  const traits: string[] = [];
  if (note && questionKind(note.text) !== null) traits.push("phrased as a question");
  if (note && hasRiskWording(note.text)) traits.push("uses risk or blocker wording");
  return [
    row({
      title: "Selected object",
      explanation: `A ${NAMES[object.type][0]}${describeObject(object) ? "" : ""} that is ${
        connected ? "connected to an arrow" : "not connected to any arrow"
      } and ${commented ? "has comments attached" : "has no comments"}.${
        traits.length > 0 ? ` It is ${traits.join(" and ")}.` : ""
      }`,
      label: "fact",
      severity: "info",
      confidence: 0.95,
      evidence: [evidenceOf(object)],
    }),
  ];
}
