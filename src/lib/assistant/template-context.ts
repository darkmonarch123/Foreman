import { TEMPLATE_CATALOG, type TemplateCategory } from "@/lib/templates/catalog";
import type { AssistantTemplateContext, RuleId } from "./types";

/** What a finished board of each template should produce. Written for people, shown in the panel. */
const OUTCOMES: Record<string, string> = {
  "project-roadmap": "a staged plan with owners and next steps",
  "brainstorming-session": "a short list of ideas worth pursuing",
  "user-story-map": "stories sliced into releases",
  "sprint-retrospective": "agreed actions, each with an owner",
  "system-design-canvas": "components, how they connect, and open questions",
  "study-planner": "topics spread across the week, with a review",
};

const CATEGORY_OUTCOMES: Record<TemplateCategory, string> = {
  PLANNING: "a plan with owners and next steps",
  BRAINSTORMING: "ideas grouped into a short list",
  STUDY: "a schedule you can follow",
  PRODUCT: "a clear, sliced scope",
  ENGINEERING: "decisions and actions with owners",
};

/** Section headings: the bold labels a template starts with (not its title or body text). */
function sectionsOf(slug: string): string[] {
  const template = TEMPLATE_CATALOG.find((entry) => entry.slug === slug);
  if (!template) return [];
  return template.content
    .filter(
      (object) =>
        object.type === "TEXT" &&
        object.props.bold === true &&
        typeof object.props.text === "string" &&
        (object.props.fontSize ?? 15) < 32,
    )
    .map((object) => String(object.props.text));
}

/** Builds the context from what the database returns (slug and category of the board's template). */
export function templateContextFor(
  template: { slug: string; category: string } | null | undefined,
): AssistantTemplateContext | null {
  if (!template) return null;
  const category = template.category as TemplateCategory;
  if (!(category in CATEGORY_OUTCOMES)) return null;
  return {
    templateId: template.slug,
    category,
    outcome: OUTCOMES[template.slug] ?? CATEGORY_OUTCOMES[category],
    expectedSections: sectionsOf(template.slug),
  };
}

/**
 * How much each kind of finding matters for each kind of board, 0.5–1.0. A brainstorm is
 * meant to be loose, so vague or ownerless notes matter less there; a retrospective or a
 * plan is about actions, so missing owners and next steps matter most. Rules not listed
 * are 1.0. Boards that did not start from a template use 1.0 for everything.
 */
const RELEVANCE: Record<TemplateCategory, Partial<Record<RuleId, number>>> = {
  PLANNING: { vague_note: 0.85, disconnected_object: 0.8 },
  BRAINSTORMING: {
    action_without_owner: 0.6,
    vague_note: 0.6,
    disconnected_object: 0.6,
    open_question_without_next_step: 0.75,
  },
  STUDY: { action_without_owner: 0.6, possible_duplicate: 0.8, theme_without_decision: 0.7 },
  PRODUCT: { overlapping_objects: 0.8, disconnected_object: 0.75 },
  ENGINEERING: { vague_note: 0.9 },
};

export function templateRelevance(template: AssistantTemplateContext | null | undefined, rule: RuleId): number {
  if (!template) return 1;
  return RELEVANCE[template.category]?.[rule] ?? 1;
}
