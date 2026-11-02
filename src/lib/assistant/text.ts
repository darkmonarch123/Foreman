import { MAX_EXCERPT } from "./types";

/**
 * Text utilities for the rule engine. All pure. User text is only ever read
 * here, never executed, parsed as markup, or interpolated into HTML.
 */

export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "get",
  "had",
  "has",
  "have",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "more",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const MIN_TOKEN_LENGTH = 3;

/**
 * Lowercase, drop apostrophes, replace other punctuation with spaces (keeping
 * "?"), collapse whitespace and trim.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinct, meaningful words in order of first appearance: no stop words, no tokens under 3 characters. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const token of normalizeText(text).replace(/\?/g, " ").split(" ")) {
    if (token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token)) seen.add(token);
  }
  return [...seen];
}

/** Jaccard similarity of two token sets. 0 when either is empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Jaccard similarity of the token sets of two texts. */
export function jaccardSimilarity(a: string, b: string): number {
  return jaccard(new Set(tokenize(a)), new Set(tokenize(b)));
}

/** A short, single-line excerpt. Control characters are removed; the text is otherwise left as typed. */
export function excerpt(text: string, max: number = MAX_EXCERPT): string {
  const clean = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…` : clean;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
