import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectCode, type BoardFixture } from "./fixtures";
import { TestDatabase, type TestUser } from "./harness";

let db: TestDatabase;
let fx: BoardFixture;

beforeAll(async () => {
  db = await TestDatabase.create();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.admin("truncate private.rate_limits");
  fx = await createBoardFixture(db);
});

interface Proposal {
  id: string;
  usefulness: number | null;
  fingerprint: string | null;
  feedback?: { helpful: boolean; reasons: string[] } | null;
}

async function run(user: TestUser, extra: Record<string, unknown> = {}): Promise<Proposal> {
  const { objectId } = await createNote(db, fx.owner, fx.boardId, { props: { text: "TBD" } });
  const [proposal] = await db.rpc<Proposal[]>(user, "assistant_create_run", {
    p_board_id: fx.boardId,
    p_context_kind: "board",
    p_context_object_id: null,
    p_action: "find_planning_gaps",
    p_guidance: null,
    p_findings: [
      {
        rule_id: "vague_note",
        title: "Vague note",
        explanation: "This note is very short.",
        label: "suggestion",
        severity: "info",
        confidence: 0.55,
        usefulness: 0.3081,
        fingerprint: `vague_note:${objectId}`,
        evidence: [{ object_id: objectId, version: 1, excerpt: "TBD" }],
        proposal: null,
        target_object_id: null,
        target_object_version: null,
        ...extra,
      },
    ],
  });
  return proposal;
}

const setFeedback = (user: TestUser, proposalId: string, helpful: boolean, reasons: string[] = [], hide = false) =>
  db.rpc<{ helpful: boolean; reasons: string[] }>(user, "assistant_set_feedback", {
    p_proposal_id: proposalId,
    p_helpful: helpful,
    p_reasons: reasons,
    p_hide_rule: hide,
  });

const feedbackEvents = async () =>
  (
    await db.admin<{ event: string; details: Record<string, unknown> }>(
      "select event, details from public.assistant_feedback_events where board_id = $1 order by seq",
      [fx.boardId],
    )
  ).map((row) => ({ event: row.event, details: row.details }));

const snapshotFeedback = (user: TestUser) =>
  db
    .rpc<{ feedback: { hidden_rules: string[]; rules: Record<string, unknown>; not_helpful: string[] } }>(
      user,
      "assistant_board_snapshot",
      { p_board_id: fx.boardId, p_action: "find_planning_gaps" },
    )
    .then((snapshot) => snapshot.feedback);

describe("usefulness and fingerprint", () => {
  it("are stored with the finding and returned", async () => {
    const proposal = await run(fx.owner);
    expect(Number(proposal.usefulness)).toBeCloseTo(0.3081, 4);
    expect(proposal.fingerprint).toMatch(/^vague_note:/);
  });

  it("reject a fingerprint that is not a rule id and object ids", async () => {
    await expectCode(run(fx.owner, { fingerprint: "vague_note:Secret note text" }), "VALIDATION_FAILED");
    await expectCode(run(fx.owner, { usefulness: 1.5 }), "VALIDATION_FAILED");
  });
});

describe("assistant_set_feedback", () => {
  it("records, changes and removes feedback, auditing every change", async () => {
    const proposal = await run(fx.editor);
    expect(await setFeedback(fx.editor, proposal.id, false, ["too_obvious", "duplicate"])).toMatchObject({
      helpful: false,
      reasons: ["duplicate", "too_obvious"],
    });
    expect(await setFeedback(fx.editor, proposal.id, true)).toMatchObject({ helpful: true, reasons: [] });
    const rows = await db.admin("select * from public.assistant_feedback where board_id = $1", [fx.boardId]);
    expect(rows).toHaveLength(1);

    const [listed] = await db.rpc<Proposal[]>(fx.editor, "assistant_list_proposals", { p_board_id: fx.boardId });
    expect(listed.feedback).toMatchObject({ helpful: true, reasons: [] });

    expect(await db.rpc(fx.editor, "assistant_clear_feedback", { p_proposal_id: proposal.id })).toBe(true);
    expect(await db.admin("select * from public.assistant_feedback where board_id = $1", [fx.boardId])).toHaveLength(0);
    expect((await feedbackEvents()).map((row) => row.event)).toEqual([
      "feedback_set",
      "feedback_set",
      "feedback_removed",
    ]);
  });

  it("lets viewers give feedback on their own findings; nothing on the board changes", async () => {
    const proposal = await run(fx.viewer);
    const before = await db.admin("select id, version from public.canvas_objects order by id");
    await setFeedback(fx.viewer, proposal.id, false, ["irrelevant"]);
    expect(await db.admin("select id, version from public.canvas_objects order by id")).toEqual(before);
  });

  it("only the person who ran the analysis can give feedback on it", async () => {
    const proposal = await run(fx.owner);
    await expectCode(setFeedback(fx.editor, proposal.id, true), "PROPOSAL_NOT_FOUND");
    await expectCode(setFeedback(fx.outsider, proposal.id, true), "PROPOSAL_NOT_FOUND");
    await expect(setFeedback(null as unknown as TestUser, proposal.id, true)).rejects.toThrow();
  });

  it("rejects reasons on helpful feedback and unknown reasons", async () => {
    const proposal = await run(fx.owner);
    await expectCode(setFeedback(fx.owner, proposal.id, true, ["duplicate"]), "VALIDATION_FAILED");
    await expectCode(setFeedback(fx.owner, proposal.id, false, ["rude"]), "VALIDATION_FAILED");
  });

  it("stops working when the person is removed from the board", async () => {
    const proposal = await run(fx.editor);
    await db.admin("delete from public.board_members where board_id = $1 and user_id = $2", [fx.boardId, fx.editor.id]);
    await expect(setFeedback(fx.editor, proposal.id, true)).rejects.toThrow();
  });

  it("keeps each person's feedback private", async () => {
    const proposal = await run(fx.editor);
    await setFeedback(fx.editor, proposal.id, false, ["duplicate"]);
    expect(await db.queryAs(fx.editor, "select * from public.assistant_feedback")).toHaveLength(1);
    expect(await db.queryAs(fx.owner, "select * from public.assistant_feedback")).toHaveLength(0);
    expect(await db.queryAs(fx.owner, "select * from public.assistant_feedback_events")).toHaveLength(0);
    // No one can write feedback tables directly; only the functions can.
    await expect(db.queryAs(fx.editor, "delete from public.assistant_feedback")).rejects.toThrow(/permission denied/);
    expect(await db.admin("select * from public.assistant_feedback where board_id = $1", [fx.boardId])).toHaveLength(1);
  });

  it("keeps the audit trail append-only", async () => {
    const proposal = await run(fx.owner);
    await setFeedback(fx.owner, proposal.id, true);
    await expect(db.admin("update public.assistant_feedback_events set event = 'feedback_removed'")).rejects.toThrow(
      /APPEND_ONLY/,
    );
  });
});

describe("hiding a type of finding", () => {
  it("hides with feedback, shows in the snapshot summary, and can be undone", async () => {
    const proposal = await run(fx.editor);
    await setFeedback(fx.editor, proposal.id, false, ["irrelevant"], true);
    expect(await db.rpc(fx.editor, "assistant_hidden_rules_for", { p_board_id: fx.boardId })).toEqual(["vague_note"]);
    const summary = await snapshotFeedback(fx.editor);
    expect(summary.hidden_rules).toEqual(["vague_note"]);
    expect(summary.rules).toEqual({ vague_note: { helpful: 0, not_helpful: 1 } });
    expect(summary.not_helpful).toEqual([proposal.fingerprint]);
    // Another member is unaffected.
    expect((await snapshotFeedback(fx.owner)).hidden_rules).toEqual([]);

    await db.rpc(fx.editor, "assistant_set_rule_hidden", {
      p_board_id: fx.boardId,
      p_rule_id: "vague_note",
      p_hidden: false,
    });
    expect(await db.rpc(fx.editor, "assistant_hidden_rules_for", { p_board_id: fx.boardId })).toEqual([]);
    expect((await feedbackEvents()).map((row) => row.event)).toEqual(["feedback_set", "rule_hidden", "rule_unhidden"]);
  });

  it("requires board membership", async () => {
    await expectCode(
      db.rpc(fx.outsider, "assistant_set_rule_hidden", {
        p_board_id: fx.boardId,
        p_rule_id: "vague_note",
        p_hidden: true,
      }),
      "BOARD_NOT_FOUND",
    );
  });
});

describe("snapshot template", () => {
  it("names the board's template when it started from one", async () => {
    const template = (await db.admin<{ id: string; slug: string }>("select id, slug from public.templates limit 1"))[0];
    await db.admin("update public.boards set template_id = $1 where id = $2", [template.id, fx.boardId]);
    const snapshot = await db.rpc<{ template: { slug: string; category: string } }>(
      fx.owner,
      "assistant_board_snapshot",
      {
        p_board_id: fx.boardId,
        p_action: "explain_board",
      },
    );
    expect(snapshot.template.slug).toBe(template.slug);
  });
});
