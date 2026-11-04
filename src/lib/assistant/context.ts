import { TYPE_LABELS } from "@/lib/board/defaults";
import type { CanvasObject } from "@/lib/board/types";
import { ARROW_ATTACH_TOLERANCE, arrowEnds, boxOf, pointInBox, type Box } from "./geometry";
import { excerpt, jaccard, normalizeText, tokenize } from "./text";
import type { AnalysisComment, EvidenceRef } from "./types";

/** Prefixes on notes the Assistant itself creates. Text rules skip these so the Assistant never critiques its own notes. */
export const ASSISTANT_PREFIXES = [
  "Decide:",
  "Owner needed:",
  "Clarify:",
  "Merge review:",
  "Connect:",
  "Separate:",
  "Next step:",
  "Owner:",
  "Risk:",
] as const;

export function isAssistantNote(text: string): boolean {
  const start = text.trimStart().toLowerCase();
  return ASSISTANT_PREFIXES.some((prefix) => start.startsWith(prefix.toLowerCase()));
}

const QUESTION_WORDS: ReadonlySet<string> = new Set(["what", "why", "how", "who", "when", "where", "which"]);

/** "explicit" when the text ends in "?", "implicit" when it only starts with a question word. */
export function questionKind(text: string): "explicit" | "implicit" | null {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return "explicit";
  const first = normalizeText(trimmed).split(" ")[0] ?? "";
  return QUESTION_WORDS.has(first) ? "implicit" : null;
}

/** The question without its trailing question marks. */
export function stripQuestion(text: string): string {
  return text.trim().replace(/[?\s]+$/, "");
}

const ACTION_PATTERN =
  /\b(?:decide|assign|deliver|fix|build|review|investigate|prepare|ship|implement|resolve)(?:s|d|es|ing)?\b/i;
const OWNER_PATTERN = /@[\p{L}\p{N}_]+|\b(?:owner|owners|owned by|assignee|assigned to|responsible|dri)\b/iu;

export function hasActionVerb(text: string): boolean {
  return ACTION_PATTERN.test(text);
}

export function hasOwnerWording(text: string): boolean {
  return OWNER_PATTERN.test(text);
}

const RISK_WORDS: ReadonlySet<string> = new Set([
  "risk",
  "risks",
  "risky",
  "blocker",
  "blockers",
  "blocked",
  "blocking",
  "concern",
  "concerns",
  "limited",
  "depends",
  "dependency",
  "unclear",
  "delay",
  "delayed",
  "issue",
  "issues",
  "problem",
  "problems",
]);

export function hasRiskWording(text: string): boolean {
  return normalizeText(text)
    .split(" ")
    .some((word) => RISK_WORDS.has(word));
}

/** A sticky note or text object, with its text pre-processed once. */
export interface Note {
  object: CanvasObject;
  text: string;
  norm: string;
  tokens: string[];
  tokenSet: Set<string>;
  box: Box;
  empty: boolean;
  /** Created by the Assistant (starts with one of its prefixes). */
  assistant: boolean;
}

export interface Ctx {
  /** Live objects after guidance exclusions. */
  objects: CanvasObject[];
  byId: Map<string, CanvasObject>;
  /** Every live object's box, including excluded ones, so new notes never land on top of anything. */
  occupied: Box[];
  /** Sticky notes and text objects (including empty and Assistant ones). */
  notes: Note[];
  arrows: CanvasObject[];
  commentedIds: Set<string>;
}

export function buildCtx(
  objects: readonly CanvasObject[],
  comments: readonly AnalysisComment[],
  excluded: (note: Note) => boolean,
): Ctx {
  const live = objects.filter((object) => !object.deleted);
  const occupied = live.map((object) => boxOf(object));

  const allNotes: Note[] = [];
  for (const object of live) {
    if (object.type !== "STICKY_NOTE" && object.type !== "TEXT") continue;
    const text = object.props.text ?? "";
    allNotes.push({
      object,
      text,
      norm: normalizeText(text),
      tokens: tokenize(text),
      tokenSet: new Set(tokenize(text)),
      box: boxOf(object),
      empty: text.trim() === "",
      assistant: isAssistantNote(text),
    });
  }
  const dropped = new Set(allNotes.filter(excluded).map((note) => note.object.id));
  const kept = live.filter((object) => !dropped.has(object.id));

  return {
    objects: kept,
    byId: new Map(kept.map((object) => [object.id, object])),
    occupied,
    notes: allNotes.filter((note) => !dropped.has(note.object.id)),
    arrows: kept.filter((object) => object.type === "ARROW"),
    commentedIds: new Set(comments.map((comment) => comment.object_id).filter((id): id is string => Boolean(id))),
  };
}

/** The text of an object, or its type name when it has none. */
export function describeObject(object: CanvasObject): string {
  const text = object.props.text ?? "";
  return text.trim() ? excerpt(text) : TYPE_LABELS[object.type];
}

export function evidenceOf(object: CanvasObject): EvidenceRef {
  return { object_id: object.id, version: object.version, excerpt: describeObject(object) };
}

/** Reading order: top to bottom, then left to right. */
export function readingOrder(a: CanvasObject, b: CanvasObject): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/** True if any arrow starts or ends on (or right next to) the object. */
export function isAttachedToArrow(ctx: Ctx, object: CanvasObject): boolean {
  const box = boxOf(object);
  return ctx.arrows.some((arrow) => arrowEnds(arrow).some(([x, y]) => pointInBox(box, x, y, ARROW_ATTACH_TOLERANCE)));
}

export interface Theme {
  keywords: string[];
  notes: Note[];
}

/**
 * Keywords of 4+ letters shared by at least two notes, grouped by the exact
 * set of notes that share them. Most widely shared first.
 */
export function findThemes(notes: readonly Note[]): Theme[] {
  const candidates = notes.filter((note) => !note.empty && !note.assistant);
  const byKeyword = new Map<string, Note[]>();
  for (const note of candidates) {
    for (const token of note.tokens) {
      if (token.length < 4) continue;
      const list = byKeyword.get(token) ?? [];
      list.push(note);
      byKeyword.set(token, list);
    }
  }
  const crowded = candidates.length >= 5 ? candidates.length * 0.6 : Infinity;
  const groups = new Map<string, Theme>();
  for (const [keyword, group] of [...byKeyword.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2 || group.length > crowded) continue;
    const key = group
      .map((note) => note.object.id)
      .sort()
      .join("|");
    const existing = groups.get(key);
    if (existing) existing.keywords.push(keyword);
    else groups.set(key, { keywords: [keyword], notes: [...group].sort((a, b) => readingOrder(a.object, b.object)) });
  }
  return [...groups.values()].sort(
    (a, b) => b.notes.length - a.notes.length || a.keywords[0].localeCompare(b.keywords[0]),
  );
}

export function tokenSetsSimilarity(a: Note, b: Note): number {
  return jaccard(a.tokenSet, b.tokenSet);
}
