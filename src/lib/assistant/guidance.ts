import { normalizeText, tokenize } from "./text";

/**
 * Optional guidance is not free-form instruction following. The engine
 * recognizes exactly one kind of instruction: leave something out, in phrases
 * like "do not include billing" or "ignore pricing and launch". Everything
 * else is reported back as not applied.
 */

const EXCLUDE_PATTERNS: RegExp[] = [
  /\b(?:do not|dont|never|without)\s+(?:include|including|use|using|mention|mentioning|add|adding|propose|proposing|suggest|suggesting|cover|covering)?\s*(.+)$/,
  /\b(?:exclude|excluding|ignore|ignoring|skip|skipping|omit|omitting|leave out)\s+(.+)$/,
];

export interface ParsedGuidance {
  /** Distinct words whose notes are left out of the analysis. */
  terms: string[];
  /** True when guidance was given but no leave-out instruction was found. */
  ignored: boolean;
}

export function parseGuidance(guidance: string | null | undefined): ParsedGuidance {
  const text = (guidance ?? "").trim();
  if (text === "") return { terms: [], ignored: false };

  const terms = new Set<string>();
  for (const sentence of text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[.;!\n]+/)) {
    for (const pattern of EXCLUDE_PATTERNS) {
      const match = pattern.exec(sentence.trim());
      if (!match) continue;
      for (const part of match[1].split(/,|\band\b|\bor\b/)) {
        for (const token of tokenize(part)) terms.add(token);
      }
    }
  }
  return { terms: [...terms].sort(), ignored: terms.size === 0 };
}

/** Light stemming so "billing", "bill" and "bills" compare equal. */
export function stem(token: string): string {
  let word = token;
  if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
  else if (word.length > 4 && word.endsWith("es")) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith("s")) word = word.slice(0, -1);
  return word;
}

/** True if the text mentions any excluded term. */
export function mentionsAny(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const stems = new Set(terms.map(stem));
  return normalizeText(text)
    .split(" ")
    .some((word) => stems.has(stem(word)));
}
