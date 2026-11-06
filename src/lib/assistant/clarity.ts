import { hasActionVerb, hasOwnerWording, questionKind, type Ctx } from "./context";
import { extractOwner } from "./extract";
import { RULES, isNextStep, userNotes } from "./rules";
import type { PlanningClarity } from "./types";

/**
 * Foreman Assistant v1.2: planning clarity, 0–100.
 *
 * Five parts, each 0–1, weighted: decisions 25, owners 25, next steps 20, clear notes 15,
 * structure 15. A part that does not apply (no questions, no actions) is left out and the
 * others are scaled up, so a board is never marked down for something it does not have.
 * Counts only: no text is stored or sent anywhere.
 */

type PartId = PlanningClarity["parts"][number]["id"];

const WEIGHTS: Record<PartId, number> = { decisions: 25, owners: 25, next_steps: 20, clarity: 15, structure: 15 };
const LABELS: Record<PartId, string> = {
  decisions: "Decisions",
  owners: "Owners",
  next_steps: "Next steps",
  clarity: "Clear notes",
  structure: "Structure",
};
const STRENGTHS: Record<PartId, string> = {
  decisions: "Open questions have decisions written down.",
  owners: "Work has named owners.",
  next_steps: "Next steps are written down.",
  clarity: "Notes say clearly what they mean.",
  structure: "Items are connected or grouped.",
};
const IMPROVEMENTS: Record<PartId, string> = {
  decisions: "Add a “Decide:” note for each open question.",
  owners: "Name an owner on each action, for example “Alice will handle onboarding”.",
  next_steps: "Write the next step for each open question or theme.",
  clarity: "Rewrite short or empty notes to say the outcome, owner or next step.",
  structure: "Connect related items with arrows, or group them in a section.",
};

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function planningClarity(ctx: Ctx): PlanningClarity | null {
  const notes = userNotes(ctx);
  const all = ctx.notes.filter((note) => !note.assistant);
  if (all.length === 0) return null;

  const questions = notes.filter((note) => questionKind(note.text) !== null);
  const unanswered = RULES.unanswered_question(ctx).length;
  const actions = notes.filter(
    (note) => questionKind(note.text) === null && (hasActionVerb(note.text) || extractOwner(note.text)),
  );
  const unowned = actions.filter((note) => !hasOwnerWording(note.text) && !extractOwner(note.text)).length;
  const steps = ctx.notes.filter((note) => !note.empty && isNextStep(note));
  const questionsWithoutStep = RULES.open_question_without_next_step(ctx).length;
  const vague = RULES.vague_note(ctx).length;
  const disconnected = RULES.disconnected_object(ctx).flatMap((finding) => finding.evidence).length;
  const overlaps = RULES.overlapping_objects(ctx).length;

  const parts: { id: PartId; value: number; applies: boolean; gap: string | null }[] = [
    {
      id: "decisions",
      applies: questions.length > 0,
      value: questions.length > 0 ? 1 - Math.min(unanswered, questions.length) / questions.length : 1,
      gap: unanswered > 0 ? `${plural(unanswered, "question has", "questions have")} no decision yet.` : null,
    },
    {
      id: "owners",
      applies: actions.length > 0,
      value: actions.length > 0 ? 1 - unowned / actions.length : 1,
      gap: unowned > 0 ? `${plural(unowned, "action has", "actions have")} no owner.` : null,
    },
    {
      id: "next_steps",
      applies: true,
      value:
        steps.length === 0
          ? 0
          : questions.length === 0
            ? 1
            : 1 - Math.min(questionsWithoutStep, questions.length) / questions.length,
      gap:
        steps.length === 0
          ? "No next steps are written down yet."
          : questionsWithoutStep > 0
            ? `${plural(questionsWithoutStep, "question has", "questions have")} no next step nearby.`
            : null,
    },
    {
      id: "clarity",
      applies: true,
      value: 1 - Math.min(vague, all.length) / all.length,
      gap: vague > 0 ? `${plural(vague, "note is", "notes are")} empty or vague.` : null,
    },
    {
      id: "structure",
      applies: all.length > 1,
      value: Math.max(0, 1 - Math.min(disconnected, all.length) / all.length - 0.1 * overlaps),
      gap:
        disconnected > 0 || overlaps > 0
          ? [
              disconnected > 0 ? `${plural(disconnected, "item is", "items are")} not connected to anything` : "",
              overlaps > 0 ? `${plural(overlaps, "pair of items overlaps", "pairs of items overlap")}` : "",
            ]
              .filter(Boolean)
              .join("; ") + "."
          : null,
    },
  ];

  const applicable = parts.filter((part) => part.applies);
  const totalWeight = applicable.reduce((sum, part) => sum + WEIGHTS[part.id], 0);
  const score = Math.round(
    (applicable.reduce((sum, part) => sum + part.value * WEIGHTS[part.id], 0) / totalWeight) * 100,
  );

  const improvements = applicable
    .filter((part) => part.value < 1)
    .sort((a, b) => (1 - b.value) * WEIGHTS[b.id] - (1 - a.value) * WEIGHTS[a.id])
    .slice(0, 3)
    .map((part) => IMPROVEMENTS[part.id]);

  return {
    score,
    parts: applicable.map((part) => ({
      id: part.id,
      label: LABELS[part.id],
      value: Math.round(part.value * 100) / 100,
      weight: WEIGHTS[part.id],
    })),
    strengths: applicable.filter((part) => part.value >= 0.8).map((part) => STRENGTHS[part.id]),
    gaps: applicable.filter((part) => part.value < 0.8 && part.gap).map((part) => part.gap as string),
    improvements,
  };
}
