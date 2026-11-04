import { describe, expect, it } from "vitest";
import { excerpt, jaccardSimilarity, normalizeText, tokenize } from "@/lib/assistant/text";
import { mentionsAny, parseGuidance } from "@/lib/assistant/guidance";

describe("normalizeText", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeText("  Launch   The\n\tMVP  ")).toBe("launch the mvp");
  });

  it("removes punctuation except the question mark", () => {
    expect(normalizeText("Ship it, now! (#42) — really?")).toBe("ship it now 42 really?");
  });

  it("drops apostrophes without splitting the word", () => {
    expect(normalizeText("Don’t forget Ada's draft")).toBe("dont forget adas draft");
  });
});

describe("tokenize", () => {
  it("removes stop words", () => {
    expect(tokenize("What is the plan for the launch")).toEqual(["plan", "launch"]);
  });

  it("removes tokens shorter than three characters", () => {
    expect(tokenize("UI to QA is ok")).toEqual([]);
  });

  it("returns each word once, in order of first appearance", () => {
    expect(tokenize("billing billing launch billing")).toEqual(["billing", "launch"]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 when either input has no meaningful words", () => {
    expect(jaccardSimilarity("", "launch plan")).toBe(0);
    expect(jaccardSimilarity("the and of", "the and of")).toBe(0);
  });

  it("returns 1 for identical normalized text", () => {
    expect(jaccardSimilarity("Fix the checkout bug!", "fix  checkout BUG")).toBe(1);
  });

  it("calculates partial overlap as shared words over all distinct words", () => {
    // {checkout, bug, fix} vs {checkout, bug, urgent}: 2 shared / 4 distinct
    expect(jaccardSimilarity("fix checkout bug", "urgent checkout bug")).toBe(0.5);
  });
});

describe("excerpt", () => {
  it("collapses whitespace and removes control characters", () => {
    expect(excerpt("a\u0000b\n\n  c")).toBe("a b c");
  });

  it("shortens long text with an ellipsis and never exceeds the limit", () => {
    const result = excerpt("x".repeat(200), 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns markup unchanged, as data", () => {
    expect(excerpt('<img src=x onerror="alert(1)">')).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("parseGuidance", () => {
  it("reads a “do not include” instruction", () => {
    expect(parseGuidance("Create a launch plan. Do not include billing.")).toEqual({
      terms: ["billing"],
      ignored: false,
    });
  });

  it("reads a list after ignore/exclude", () => {
    expect(parseGuidance("ignore pricing, legal and hiring").terms).toEqual(["hiring", "legal", "pricing"]);
  });

  it("reports guidance it cannot apply instead of guessing", () => {
    expect(parseGuidance("Make it more exciting")).toEqual({ terms: [], ignored: true });
  });

  it("treats empty guidance as not given", () => {
    expect(parseGuidance("   ")).toEqual({ terms: [], ignored: false });
    expect(parseGuidance(null)).toEqual({ terms: [], ignored: false });
  });

  it("matches word forms of an excluded term", () => {
    expect(mentionsAny("Decide how billing works", ["billing"])).toBe(true);
    expect(mentionsAny("Send the bills", ["bill"])).toBe(true);
    expect(mentionsAny("Ship the launch", ["billing"])).toBe(false);
  });
});
