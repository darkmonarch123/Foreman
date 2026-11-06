import { beforeEach, describe, expect, it } from "vitest";
import { analyze } from "@/lib/assistant/analyze";
import { CONFIDENCE_BANDS, confidenceBand } from "@/lib/assistant/bands";
import {
  ACTIONABILITY_WEIGHT,
  SEVERITY_WEIGHT,
  combine,
  feedbackWeight,
  fingerprintOf,
  freshnessWeight,
  merge,
  score,
  suppress,
} from "@/lib/assistant/rank";
import type { RawFinding } from "@/lib/assistant/rules";
import { feedbackSchema } from "@/lib/assistant/schemas";
import { templateContextFor, templateRelevance } from "@/lib/assistant/template-context";
import type { AnalysisInput, FeedbackSummary } from "@/lib/assistant/types";
import type { CanvasObject } from "@/lib/board/types";
import { makeObject, note, resetFixtureIds } from "../support/assistant-fixtures";

beforeEach(resetFixtureIds);

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function raw(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    rule_id: "vague_note",
    title: "Vague",
    explanation: "Too short.",
    label: "suggestion",
    severity: "warning",
    confidence: 0.8,
    evidence: [{ object_id: ID(1), version: 1, excerpt: "x" }],
    proposalText: null,
    anchorId: ID(1),
    ...overrides,
  };
}

const options = (extra: Partial<Parameters<typeof score>[1]> = {}) => ({
  byId: new Map<string, CanvasObject>(),
  now: NOW,
  ...extra,
});

function run(objects: CanvasObject[], extra: Partial<AnalysisInput> = {}) {
  return analyze({ action: "propose_plan", objects, comments: [], context: { kind: "board" }, now: NOW, ...extra });
}

describe("usefulness score", () => {
  it("multiplies confidence by severity, actionability, freshness and template relevance", () => {
    const byId = new Map([[ID(1), makeObject({ id: ID(1), updated_at: "2026-11-04T10:00:00.000Z" })]]);
    const finding = raw({ severity: "high", proposalText: "Clarify: x", confidence: 0.8 });
    expect(score(finding, options({ byId }))).toBe(0.8);
    const report = raw({ severity: "info", confidence: 0.8 });
    expect(score(report, options({ byId }))).toBeCloseTo(0.8 * SEVERITY_WEIGHT.info * ACTIONABILITY_WEIGHT.report, 4);
    const brainstorm = templateContextFor({ slug: "brainstorming-session", category: "BRAINSTORMING" });
    expect(score(report, options({ byId, template: brainstorm }))).toBeCloseTo(0.8 * 0.7 * 0.8 * 0.6, 4);
  });

  it("weights recently edited evidence higher", () => {
    const at = (iso: string) => new Map([[ID(1), makeObject({ id: ID(1), updated_at: iso })]]);
    const evidence = [{ object_id: ID(1), version: 1, excerpt: "x" }];
    expect(freshnessWeight(evidence, at("2026-11-04T00:00:00.000Z"), NOW)).toBe(1);
    expect(freshnessWeight(evidence, at("2026-11-01T00:00:00.000Z"), NOW)).toBe(0.9);
    expect(freshnessWeight(evidence, at("2026-10-15T00:00:00.000Z"), NOW)).toBe(0.8);
    expect(freshnessWeight(evidence, at("2026-01-01T00:00:00.000Z"), NOW)).toBe(0.7);
    expect(freshnessWeight(evidence, new Map(), NOW)).toBe(0.9);
  });

  it("lets the person's own votes on a rule move its weight, within limits", () => {
    const summary = (helpful: number, notHelpful: number): FeedbackSummary => ({
      hidden_rules: [],
      not_helpful: [],
      rules: { vague_note: { helpful, not_helpful: notHelpful } },
    });
    expect(feedbackWeight(null, "vague_note")).toBe(1);
    expect(feedbackWeight(summary(2, 0), "vague_note")).toBeCloseTo(1.2);
    expect(feedbackWeight(summary(0, 2), "vague_note")).toBeCloseTo(0.7);
    expect(feedbackWeight(summary(0, 10), "vague_note")).toBe(0.4);
    expect(feedbackWeight(summary(9, 0), "vague_note")).toBe(1.2);
    expect(feedbackWeight(summary(0, 5), "unanswered_question")).toBe(1);
  });

  it("never exceeds 1", () => {
    const summary: FeedbackSummary = {
      hidden_rules: [],
      not_helpful: [],
      rules: { vague_note: { helpful: 5, not_helpful: 0 } },
    };
    expect(score(raw({ severity: "high", confidence: 1, proposalText: "x" }), options({ feedback: summary }))).toBe(1);
  });
});

describe("suppress, merge and combine", () => {
  it("leaves out hidden types and findings marked not helpful, and counts them", () => {
    const a = raw();
    const b = raw({ rule_id: "unanswered_question", evidence: [{ object_id: ID(2), version: 1, excerpt: "y" }] });
    const c = raw({ rule_id: "possible_duplicate", evidence: [{ object_id: ID(3), version: 1, excerpt: "z" }] });
    const result = suppress([a, b, c], {
      hidden_rules: ["vague_note"],
      rules: {},
      not_helpful: [fingerprintOf("unanswered_question", b.evidence)],
    });
    expect(result.kept).toEqual([c]);
    expect(result.suppressed).toBe(2);
  });

  it("merges two findings about exactly the same items into the more useful one", () => {
    const question = raw({
      rule_id: "unanswered_question",
      title: "Unanswered question",
      severity: "high",
      proposalText: "Decide: x",
    });
    const nextStep = raw({ rule_id: "open_question_without_next_step", title: "No next step", severity: "warning" });
    const merged = merge([nextStep, question], options());
    expect(merged).toHaveLength(1);
    expect(merged[0].rule_id).toBe("unanswered_question");
    expect(merged[0].explanation).toContain("Also: No next step.");
  });

  it("combines three or more report-only findings of one kind", () => {
    const many = [1, 2, 3, 4].map((n) =>
      raw({ rule_id: "overlapping_objects", evidence: [{ object_id: ID(n), version: 1, excerpt: `o${n}` }] }),
    );
    const withProposal = raw({
      proposalText: "Clarify: x",
      evidence: [{ object_id: ID(9), version: 1, excerpt: "p" }],
    });
    const out = combine([...many, withProposal]);
    expect(out).toHaveLength(2);
    const combined = out.find((finding) => finding.rule_id === "overlapping_objects")!;
    expect(combined.title).toBe("4 pairs of items overlap");
    expect(combined.evidence.map((item) => item.object_id)).toEqual([1, 2, 3, 4].map(ID));
    expect(combine(many.slice(0, 2))).toHaveLength(2);
  });

  it("fingerprints use only the rule and sorted object ids", () => {
    expect(
      fingerprintOf("vague_note", [
        { object_id: ID(2), version: 3, excerpt: "secret text" },
        { object_id: ID(1), version: 1, excerpt: "more text" },
      ]),
    ).toBe(`vague_note:${ID(1)},${ID(2)}`);
  });
});

describe("analyze with v1.1 ranking", () => {
  it("returns findings ordered by usefulness, each with a score and fingerprint", () => {
    const result = run([note("TBD", 0, 0), note("Who owns onboarding?", 600, 0), note("Fix the billing bug", 1200, 0)]);
    expect(result.findings.length).toBeGreaterThan(1);
    const scores = result.findings.map((finding) => finding.usefulness!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const finding of result.findings) {
      expect(finding.fingerprint).toMatch(/^[a-z_]+:[0-9a-f,-]+$/);
      expect(finding.usefulness).toBeGreaterThan(0);
    }
  });

  it("drops a type of finding the person hid, and reports how many were left out", () => {
    const objects = [note("TBD", 0, 0), note("Who owns onboarding?", 600, 0)];
    const all = run(objects);
    const rule = all.findings[0].rule_id!;
    const hidden = run(objects, { feedback: { hidden_rules: [rule], rules: {}, not_helpful: [] } });
    expect(hidden.findings.some((finding) => finding.rule_id === rule)).toBe(false);
    expect(hidden.suppressed).toBeGreaterThan(0);
  });

  it("does not repeat a finding the person marked not helpful", () => {
    const objects = [note("TBD", 0, 0)];
    const [first] = run(objects).findings;
    const again = run(objects, { feedback: { hidden_rules: [], rules: {}, not_helpful: [first.fingerprint!] } });
    expect(again.findings.find((finding) => finding.fingerprint === first.fingerprint)).toBeUndefined();
  });

  it("passes the template context through", () => {
    const template = templateContextFor({ slug: "sprint-retrospective", category: "ENGINEERING" });
    expect(run([note("TBD")], { template }).template).toEqual(template);
  });
});

describe("confidence bands", () => {
  it("maps confidence to Clear, Likely and Possible at 0.85 and 0.65", () => {
    expect(confidenceBand(1)).toBe("clear");
    expect(confidenceBand(0.85)).toBe("clear");
    expect(confidenceBand(0.84)).toBe("likely");
    expect(confidenceBand(0.65)).toBe("likely");
    expect(confidenceBand(0.64)).toBe("possible");
    expect(confidenceBand(0.5)).toBe("possible");
    for (const band of Object.values(CONFIDENCE_BANDS)) expect(band.explanation.length).toBeGreaterThan(20);
  });
});

describe("template context", () => {
  it("names the outcome and the sections the template starts with", () => {
    expect(templateContextFor({ slug: "sprint-retrospective", category: "ENGINEERING" })).toEqual({
      templateId: "sprint-retrospective",
      category: "ENGINEERING",
      outcome: "agreed actions, each with an owner",
      expectedSections: ["Went well", "To improve", "Ideas", "Actions"],
    });
    expect(templateContextFor(null)).toBeNull();
    expect(templateContextFor({ slug: "unknown", category: "NOPE" })).toBeNull();
    expect(templateContextFor({ slug: "custom", category: "STUDY" })?.outcome).toBe("a schedule you can follow");
  });

  it("makes loose findings matter less on a brainstorm than on a plan", () => {
    const brainstorm = templateContextFor({ slug: "brainstorming-session", category: "BRAINSTORMING" });
    const plan = templateContextFor({ slug: "project-roadmap", category: "PLANNING" });
    expect(templateRelevance(brainstorm, "action_without_owner")).toBeLessThan(
      templateRelevance(plan, "action_without_owner"),
    );
    expect(templateRelevance(null, "vague_note")).toBe(1);
  });
});

describe("feedback input", () => {
  const base = { boardId: ID(1), proposalId: ID(2) };
  it("accepts helpful without reasons, and not helpful with known reasons", () => {
    expect(feedbackSchema.safeParse({ ...base, helpful: true }).success).toBe(true);
    expect(
      feedbackSchema.safeParse({ ...base, helpful: false, reasons: ["duplicate", "too_obvious"], hideRule: true })
        .success,
    ).toBe(true);
  });
  it("rejects reasons on helpful feedback, unknown reasons and extra fields", () => {
    expect(feedbackSchema.safeParse({ ...base, helpful: true, reasons: ["duplicate"] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...base, helpful: false, reasons: ["rude"] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...base, helpful: false, userId: ID(3) }).success).toBe(false);
  });
});
