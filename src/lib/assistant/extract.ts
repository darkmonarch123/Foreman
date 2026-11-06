import { evidenceOf, type Ctx, type Note } from "./context";
import type { RawFinding, Rule } from "./rules";
import { excerpt, normalizeText } from "./text";

/**
 * Foreman Assistant v1.2: action extraction.
 *
 * Turns plain sentences on notes into clear planning items:
 *
 *   "We need to decide pricing"      → "Decide: Pricing approach"
 *   "Alice will handle onboarding"   → "Owner: Alice — Onboarding"
 *   "This might break checkout"      → "Risk: Checkout regression"
 *   "Investigate slow dashboard"     → "Next step: Investigate dashboard performance"
 *
 * Deterministic patterns only. An owner is suggested only when a note names a person and
 * commits them ("Alice will handle…"); responsibility is never inferred from anything else
 * (who wrote the note, who was mentioned nearby, or "we"/"someone"). Text is matched and
 * excerpted, never evaluated.
 */

const MAX_TOPIC = 80;

function clean(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;,\s]+$/, "");
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function stripArticles(text: string): string {
  return text.replace(/^(?:the|a|an|our|their|my|your|this|that)\s+/i, "");
}

function topic(text: string): string {
  return excerpt(stripArticles(clean(text)), MAX_TOPIC);
}

// -- decisions ---------------------------------------------------------------

const DECISION_PATTERNS = [
  /\b(?:need|needs|have|has|must|should|got)\s+to\s+(?:decide|agree|choose|settle)\s+(?:on\s+|about\s+|upon\s+)?(.+)$/i,
  /^(?:decision needed|to decide|undecided|open decision)\s*[:\-–—]\s*(.+)$/i,
  /^(?:tbd|to be decided)\s*[:\-–—]\s*(.+)$/i,
];
const OPEN_QUESTION_START = /^(?:whether|how|which|what|if|when|who|where)\b/i;

/** "We need to decide pricing" → "Pricing approach". Null when there is no explicit decision. */
export function extractDecision(text: string): string | null {
  const line = clean(text);
  for (const pattern of DECISION_PATTERNS) {
    const match = line.match(pattern);
    if (!match?.[1]) continue;
    const subject = topic(match[1]);
    if (!subject) return null;
    if (OPEN_QUESTION_START.test(subject)) return capitalise(subject);
    const words = subject.split(" ").length;
    return capitalise(words <= 2 && !/\bapproach\b/i.test(subject) ? `${subject} approach` : subject);
  }
  return null;
}

// -- owners ------------------------------------------------------------------

/** Words that look like names at the start of a sentence but never identify one person. */
const NOT_A_PERSON = new Set(
  [
    "we",
    "i",
    "you",
    "they",
    "he",
    "she",
    "it",
    "someone",
    "somebody",
    "everyone",
    "everybody",
    "anyone",
    "anybody",
    "nobody",
    "team",
    "the",
    "this",
    "that",
    "these",
    "those",
    "who",
    "what",
    "which",
    "there",
    "here",
    "maybe",
    "perhaps",
    "probably",
    "next",
    "then",
    "tbd",
  ].map((word) => word.toLowerCase()),
);

const COMMITMENT =
  "(?:will|is going to|['’]ll|is|has agreed to|agreed to|volunteered to)\\s+(?:handle|handling|own|owning|take care of|taking care of|look after|looking after|lead|leading|drive|driving|manage|managing|cover|covering|work on|working on|deliver|delivering)";
const OWNER_PATTERNS = [
  // "Alice will handle onboarding", "Alice Smith is leading the launch"
  new RegExp(`^@?([A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+)?)\\s+${COMMITMENT}\\s+(.+)$`, "u"),
  // "@alice owns billing"
  /^@([\p{L}\p{N}_.-]+)\s+(?:owns|will own|handles|will handle|is on)\s+(.+)$/u,
  // "Onboarding — owner: Alice", "Billing (owner: @sam)"
  /^(.+?)\s*[-–—(]\s*owner\s*[:=]\s*@?([A-Z][\p{L}'’-]+|[\p{Ll}\p{N}_.-]+)\)?$/u,
];

/** "Alice will handle onboarding" → { person: "Alice", task: "Onboarding" }. Only explicit attribution. */
export function extractOwner(text: string): { person: string; task: string } | null {
  const line = clean(text);
  if (/[?]$/.test(text.trim())) return null;
  for (const [index, pattern] of OWNER_PATTERNS.entries()) {
    const match = line.match(pattern);
    if (!match) continue;
    const [person, task] = index === 2 ? [match[2], match[1]] : [match[1], match[2]];
    const first = person.split(/\s+/)[0].toLowerCase();
    if (NOT_A_PERSON.has(first)) return null;
    const subject = topic(task);
    if (!subject) return null;
    return {
      person: index === 1 || (index === 2 && !/^[A-Z]/.test(person)) ? `@${person}` : person,
      task: capitalise(subject),
    };
  }
  return null;
}

// -- risks -------------------------------------------------------------------

const RISK_EFFECTS: [RegExp, (subject: string) => string][] = [
  [/^break(?:s)?$/i, (subject) => `${subject} regression`],
  [/^(?:slow|slows|slow down)$/i, (subject) => `${subject} performance`],
  [/^(?:delay|delays|hold up)$/i, (subject) => `${subject} delay`],
  [/^(?:block|blocks)$/i, (subject) => `${subject} blocked`],
  [/^(?:affect|affects|hurt|hurts|impact|impacts)$/i, (subject) => `${subject} impact`],
];
const RISK_PATTERN =
  /\b(?:might|may|could|can|would|will probably|risks? to)\s+(break|breaks|slow down|slows|slow|delay|delays|hold up|block|blocks|affect|affects|hurt|hurts|impact|impacts)\s+(.+)$/i;

/** "This might break checkout" → "Checkout regression". */
export function extractRisk(text: string): string | null {
  const match = clean(text).match(RISK_PATTERN);
  if (!match) return null;
  const subject = topic(match[2]);
  if (!subject) return null;
  for (const [effect, describe] of RISK_EFFECTS) {
    if (effect.test(match[1])) return capitalise(describe(subject));
  }
  return null;
}

// -- next steps --------------------------------------------------------------

const NEXT_STEP_VERBS =
  "investigate|fix|review|prepare|draft|write|test|check|research|explore|measure|profile|audit|update|migrate|benchmark|follow up on|follow up with|document|set up|clean up|design|prototype|validate|verify|reproduce|debug|optimise|optimize|estimate|plan|schedule|contact|email|call|ask";
const NEXT_STEP_PATTERN = new RegExp(`^(${NEXT_STEP_VERBS})\\s+(.+)$`, "i");

/** "Investigate slow dashboard" → "Investigate dashboard performance". */
export function extractNextStep(text: string): string | null {
  if (/[?]$/.test(text.trim())) return null;
  const match = clean(text).match(NEXT_STEP_PATTERN);
  if (!match) return null;
  let subject = topic(match[2]);
  if (!subject) return null;
  const slow = subject.match(/^(?:slow|sluggish|laggy)\s+(.+)$/i);
  if (slow) subject = `${slow[1]} performance`;
  const broken = subject.match(/^(?:broken|failing|flaky)\s+(.+)$/i);
  if (broken) subject = `${broken[1]} failures`;
  return `${capitalise(match[1].toLowerCase())} ${subject}`;
}

// -- rules -------------------------------------------------------------------

function candidates(ctx: Ctx): Note[] {
  return ctx.notes.filter((note) => !note.empty && !note.assistant);
}

function existingAssistantNotes(ctx: Ctx): Set<string> {
  return new Set(ctx.notes.filter((note) => note.assistant).map((note) => note.norm));
}

function extractionRule(
  ruleId: RawFinding["rule_id"],
  extract: (note: Note) => string | null,
  shape: Pick<RawFinding, "title" | "explanation" | "label" | "severity" | "confidence">,
): Rule {
  return (ctx) => {
    const existing = existingAssistantNotes(ctx);
    const findings: RawFinding[] = [];
    for (const note of candidates(ctx)) {
      const proposalText = extract(note);
      if (!proposalText || existing.has(normalizeText(proposalText))) continue;
      findings.push({
        rule_id: ruleId,
        ...shape,
        evidence: [evidenceOf(note.object)],
        proposalText,
        anchorId: note.object.id,
      });
    }
    return findings;
  };
}

export const extractedDecision = extractionRule(
  "extracted_decision",
  (note) => {
    const decision = extractDecision(note.text);
    return decision ? `Decide: ${decision}` : null;
  },
  {
    title: "Decision to record",
    explanation: "This note says a decision is needed. A “Decide” note makes it easy to find and close.",
    label: "inference",
    severity: "warning",
    confidence: 0.8,
  },
);

export const extractedOwner = extractionRule(
  "extracted_owner",
  (note) => {
    const owner = extractOwner(note.text);
    return owner ? `Owner: ${owner.person} — ${owner.task}` : null;
  },
  {
    title: "Owner named on this note",
    explanation: "This note names who will do the work. Recording it as an owner keeps it visible.",
    label: "fact",
    severity: "info",
    confidence: 0.9,
  },
);

export const extractedRisk = extractionRule(
  "extracted_risk",
  (note) => {
    const risk = extractRisk(note.text);
    return risk ? `Risk: ${risk}` : null;
  },
  {
    title: "Risk to record",
    explanation: "This note describes something that might go wrong. Recording it as a risk helps plan a mitigation.",
    label: "inference",
    severity: "warning",
    confidence: 0.7,
  },
);

export const extractedNextStep = extractionRule(
  "extracted_next_step",
  (note) => {
    const step = extractNextStep(note.text);
    return step ? `Next step: ${step}` : null;
  },
  {
    title: "Next step to record",
    explanation: "This note starts with an action. Recording it as a next step makes the plan easier to follow.",
    label: "suggestion",
    severity: "info",
    confidence: 0.65,
  },
);
