import { beforeEach, describe, expect, it } from "vitest";
import { analyze } from "@/lib/assistant/analyze";
import { extractDecision, extractNextStep, extractOwner, extractRisk } from "@/lib/assistant/extract";
import { runAnalysisSchema } from "@/lib/assistant/schemas";
import type { AnalysisInput } from "@/lib/assistant/types";
import type { CanvasObject } from "@/lib/board/types";
import { arrow, note, resetFixtureIds } from "../support/assistant-fixtures";

beforeEach(resetFixtureIds);

function run(objects: CanvasObject[], extra: Partial<AnalysisInput> = {}) {
  return analyze({ action: "propose_plan", objects, comments: [], context: { kind: "board" }, ...extra });
}

describe("action extraction: the four examples", () => {
  it("decisions", () => {
    expect(extractDecision("We need to decide pricing")).toBe("Pricing approach");
    expect(extractDecision("We have to decide whether to launch in May.")).toBe("Whether to launch in May");
    expect(extractDecision("Decision needed: the launch date for the beta")).toBe("Launch date for the beta");
    expect(extractDecision("Pricing looks fine")).toBeNull();
  });

  it("owners, only with explicit attribution", () => {
    expect(extractOwner("Alice will handle onboarding")).toEqual({ person: "Alice", task: "Onboarding" });
    expect(extractOwner("Sam Lee is leading the launch")).toEqual({ person: "Sam Lee", task: "Launch" });
    expect(extractOwner("@sam owns billing")).toEqual({ person: "@sam", task: "Billing" });
    expect(extractOwner("Onboarding - owner: Alice")).toEqual({ person: "Alice", task: "Onboarding" });
    // Never inferred: no named person, a pronoun, uncertainty, or a question.
    for (const text of [
      "We will handle onboarding",
      "Someone will handle onboarding",
      "Alice might handle onboarding",
      "Alice could look at onboarding",
      "Will Alice handle onboarding?",
      "Onboarding",
      "Talk to Alice about onboarding",
      "The team will handle onboarding",
      "Alice is running late",
    ]) {
      expect(extractOwner(text), text).toBeNull();
    }
  });

  it("risks", () => {
    expect(extractRisk("This might break checkout")).toBe("Checkout regression");
    expect(extractRisk("The migration could slow down search")).toBe("Search performance");
    expect(extractRisk("Vendor contract may delay the launch")).toBe("Launch delay");
    expect(extractRisk("Checkout works")).toBeNull();
  });

  it("next steps", () => {
    expect(extractNextStep("Investigate slow dashboard")).toBe("Investigate dashboard performance");
    expect(extractNextStep("Fix the flaky login test")).toBe("Fix login test failures");
    expect(extractNextStep("Should we investigate the dashboard?")).toBeNull();
    expect(extractNextStep("Dashboard is slow")).toBeNull();
  });
});

describe("extraction findings", () => {
  it("proposes one prefixed note per extraction, next to the source", () => {
    const board = [
      note("We need to decide pricing", 0, 0),
      note("Alice will handle onboarding", 600, 0),
      note("This might break checkout", 1200, 0),
      note("Investigate slow dashboard", 1800, 0),
    ];
    const texts = run(board, { postprocess: false })
      .findings.filter((finding) => finding.rule_id?.startsWith("extracted_"))
      .map((finding) => finding.proposal?.object.props.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Decide: Pricing approach",
        "Owner: Alice — Onboarding",
        "Risk: Checkout regression",
        "Next step: Investigate dashboard performance",
      ]),
    );
  });

  it("does not propose a note that is already on the board, nor critique the Assistant's notes", () => {
    const board = [note("Alice will handle onboarding", 0, 0), note("Owner: Alice — Onboarding", 300, 0)];
    const owners = run(board, { postprocess: false }).findings.filter(
      (finding) => finding.rule_id === "extracted_owner",
    );
    expect(owners).toEqual([]);
  });

  it("owner suggestions are labelled as facts with clear confidence; nothing else names an owner", () => {
    const board = [note("Alice will handle onboarding"), note("Fix the billing bug", 600, 0)];
    const findings = run(board, { postprocess: false }).findings;
    const owner = findings.find((finding) => finding.rule_id === "extracted_owner")!;
    expect(owner).toMatchObject({ label: "fact", confidence: 0.9 });
    const named = findings.filter((finding) => /Owner: /.test(finding.proposal?.object.props.text ?? ""));
    expect(named).toHaveLength(1);
  });
});

describe("focus", () => {
  const board = () => [
    note("We need to decide pricing", 0, 0),
    note("Alice will handle onboarding", 600, 0),
    note("This might break checkout", 1200, 0),
    note("Investigate slow dashboard", 1800, 0),
    note("Who owns support?", 0, 600),
  ];

  it("keeps only the matching kinds of finding", () => {
    const rules = (focus: AnalysisInput["focus"]) =>
      new Set(run(board(), { focus, postprocess: false }).findings.map((finding) => finding.rule_id));
    for (const id of rules("owners")) expect(["action_without_owner", "extracted_owner"]).toContain(id);
    expect(rules("owners").has("extracted_owner")).toBe(true);
    expect(rules("risks")).toEqual(new Set(["extracted_risk"]));
    expect(rules("decisions").has("extracted_decision")).toBe(true);
    expect(rules("decisions").has("unanswered_question")).toBe(true);
    expect(rules("decisions").has("extracted_risk")).toBe(false);
    expect(rules("next_steps").has("extracted_next_step")).toBe(true);
    expect(rules("everything").size).toBeGreaterThan(rules("risks").size);
    expect(run(board(), { focus: "risks" }).focus).toBe("risks");
  });

  it("is validated at the boundary", () => {
    const base = {
      boardId: "00000000-0000-4000-8000-000000000001",
      action: "find_planning_gaps",
      context: { kind: "board" },
    };
    expect(runAnalysisSchema.safeParse({ ...base, focus: "owners" }).success).toBe(true);
    expect(runAnalysisSchema.safeParse({ ...base, focus: "gossip" }).success).toBe(false);
  });
});

describe("planning clarity", () => {
  it("is null for an empty board", () => {
    expect(run([]).clarity).toBeNull();
  });

  it("scores a clear, owned, connected plan highly with strengths and no gaps", () => {
    const a = note("Decide: launch date is 12 May", 0, 0);
    const b = note("Alice will handle the launch checklist", 400, 0);
    const c = note("Next step: Alice drafts the announcement", 800, 0);
    const clarity = run([a, b, c, arrow(180, 70, 400, 70), arrow(580, 70, 800, 70)]).clarity!;
    expect(clarity.score).toBeGreaterThanOrEqual(80);
    expect(clarity.strengths.length).toBeGreaterThan(0);
    expect(clarity.gaps).toEqual([]);
  });

  it("explains gaps and what would improve a messy board", () => {
    const clarity = run([
      note("Who owns support?", 0, 0),
      note("Fix the billing bug", 600, 0),
      note("TBD", 1200, 0),
      note("", 1800, 0),
    ]).clarity!;
    expect(clarity.score).toBeLessThan(60);
    expect(clarity.gaps.join(" ")).toMatch(/no decision|no owner|vague|not connected/);
    expect(clarity.improvements.length).toBeGreaterThan(0);
    expect(clarity.improvements.length).toBeLessThanOrEqual(3);
    for (const part of clarity.parts) {
      expect(part.value).toBeGreaterThanOrEqual(0);
      expect(part.value).toBeLessThanOrEqual(1);
    }
  });

  it("never quotes note text", () => {
    const secret = "Project Nightingale budget is 4.2m";
    const clarity = run([note(secret), note("Who approves Nightingale?", 600, 0)]).clarity!;
    expect(JSON.stringify(clarity)).not.toMatch(/Nightingale|4\.2m/);
  });
});
