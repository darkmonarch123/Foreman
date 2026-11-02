import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectCode, expectDenied, submit, type BoardFixture } from "./fixtures";
import { TestDatabase, uuid, type TestUser } from "./harness";

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

interface ProposalRow {
  id: string;
  status: string;
  applied_operation_id: string | null;
  edited_proposal: unknown;
  target_object_version: number | null;
  evidence: { object_id: string; version: number; excerpt: string }[];
  proposal: { object: { props: { text: string } } } | null;
}

function noteProposal(text = "Decide: Who owns onboarding") {
  return {
    kind: "create_object",
    object: {
      type: "STICKY_NOTE",
      x: 300,
      y: 20,
      width: 180,
      height: 140,
      props: { text, fill: "#AEB9F4", color: "#121212", fontSize: 15 },
    },
  };
}

function finding(objectId: string, version = 1, overrides: Record<string, unknown> = {}) {
  return {
    rule_id: "unanswered_question",
    title: "Unanswered question",
    explanation: "This note is a question.",
    label: "inference",
    severity: "high",
    confidence: 0.8,
    evidence: [{ object_id: objectId, version, excerpt: "Who owns onboarding?" }],
    proposal: noteProposal(),
    target_object_id: objectId,
    target_object_version: version,
    ...overrides,
  };
}

function createRun(
  user: TestUser,
  boardId: string,
  findings: unknown[],
  extra: { action?: string; kind?: string; objectId?: string | null; guidance?: string | null } = {},
) {
  return db.rpc<ProposalRow[]>(user, "assistant_create_run", {
    p_board_id: boardId,
    p_context_kind: extra.kind ?? "board",
    p_context_object_id: extra.objectId ?? null,
    p_action: extra.action ?? "find_planning_gaps",
    p_guidance: extra.guidance ?? null,
    p_findings: findings,
  });
}

/** An owner note plus one pending proposal about it, made by `by`. */
async function proposalFor(by: TestUser = fx.owner, text = "Who owns onboarding?") {
  const { objectId } = await createNote(db, fx.owner, fx.boardId, { props: { text } });
  const [proposal] = await createRun(by, fx.boardId, [finding(objectId)]);
  return { objectId, proposal };
}

async function accept(user: TestUser, proposalId: string) {
  return db.rpc<{
    status: string;
    reason?: { object_id: string; reason: string };
    code?: string;
    proposal: ProposalRow;
    operation?: { operation_id: string; sequence: number; object: { id: string; props: { text: string } } };
  }>(user, "assistant_accept_proposal", { p_proposal_id: proposalId });
}

async function events(proposalId: string): Promise<string[]> {
  const rows = await db.admin<{ event: string }>(
    "select event from public.assistant_proposal_events where proposal_id = $1 order by seq",
    [proposalId],
  );
  return rows.map((row) => row.event);
}

async function objectCount(): Promise<number> {
  const rows = await db.admin<{ n: number }>(
    "select count(*)::int as n from public.canvas_objects where board_id = $1 and deleted_at is null",
    [fx.boardId],
  );
  return rows[0].n;
}

describe("schema", () => {
  it("creates both tables with row level security enabled", async () => {
    const rows = await db.admin<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('assistant_proposals', 'assistant_proposal_events') and relkind = 'r'`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("has no policy that uses (true)", async () => {
    const rows = await db.admin<{ qual: string | null }>(
      `select qual from pg_policies where tablename in ('assistant_proposals', 'assistant_proposal_events')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.qual !== "true")).toBe(true);
  });

  it("rejects invalid enum and range values at the table level", async () => {
    const { proposal } = await proposalFor();
    const bad = (column: string, value: string) =>
      db.admin(`update public.assistant_proposals set ${column} = ${value} where id = $1`, [proposal.id]);
    await expect(bad("label", "'certain'")).rejects.toThrow();
    await expect(bad("severity", "'critical'")).rejects.toThrow();
    await expect(bad("action", "'delete_board'")).rejects.toThrow();
    await expect(bad("status", "'applied'")).rejects.toThrow();
    await expect(bad("confidence", "1.5")).rejects.toThrow();
    await expect(bad("applied_operation_id", `'${uuid()}'`)).rejects.toThrow(); // still pending
  });
});

describe("reading", () => {
  it("keeps proposals invisible to people who are not on the board", async () => {
    await proposalFor();
    const asOutsider = await db.queryAs(fx.outsider, "select id from public.assistant_proposals");
    const asOwner = await db.queryAs(fx.owner, "select id from public.assistant_proposals");
    expect(asOutsider).toEqual([]);
    expect(asOwner).toHaveLength(1);
  });

  it("lets a viewer read proposals but not change them", async () => {
    await proposalFor();
    expect(await db.queryAs(fx.viewer, "select id from public.assistant_proposals")).toHaveLength(1);
    await expectDenied(db.queryAs(fx.viewer, "update public.assistant_proposals set status = 'rejected'"));
    await expectDenied(db.queryAs(fx.viewer, "delete from public.assistant_proposals"));
  });

  it("gives nobody direct write access, not even the owner", async () => {
    const { proposal } = await proposalFor();
    for (const user of [fx.owner, fx.editor]) {
      await expectDenied(
        db.queryAs(user, "update public.assistant_proposals set status = 'accepted' where id = $1", [proposal.id]),
      );
      await expectDenied(db.queryAs(user, "delete from public.assistant_proposals where id = $1", [proposal.id]));
      await expectDenied(
        db.queryAs(
          user,
          `insert into public.assistant_proposals (board_id, created_by, context_kind, action, title, explanation, label, severity, confidence)
           values ($1, $2, 'board', 'find_planning_gaps', 't', 'e', 'fact', 'info', 0.9)`,
          [fx.boardId, user.id],
        ),
      );
    }
  });

  it("returns only the caller's own pending proposals from the list function", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await createRun(fx.owner, fx.boardId, [finding(objectId)]);
    await createRun(fx.editor, fx.boardId, [finding(objectId)]);
    const mine = await db.rpc<ProposalRow[]>(fx.editor, "assistant_list_proposals", { p_board_id: fx.boardId });
    expect(mine).toHaveLength(1);
    await expectCode(db.rpc(fx.outsider, "assistant_list_proposals", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
  });
});

describe("creating a run", () => {
  it("stores short excerpts only and never more than 120 characters", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const [row] = await createRun(fx.owner, fx.boardId, [
      finding(objectId, 1, { evidence: [{ object_id: objectId, version: 1, excerpt: "x".repeat(500) }] }),
    ]);
    expect(row.evidence[0].excerpt).toHaveLength(120);
  });

  it("rejects malformed findings", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await expectCode(
      createRun(fx.owner, fx.boardId, [finding(objectId, 1, { label: "certain" })]),
      "VALIDATION_FAILED",
    );
    await expectCode(
      createRun(fx.owner, fx.boardId, [finding(objectId, 1, { severity: "critical" })]),
      "VALIDATION_FAILED",
    );
    await expectCode(createRun(fx.owner, fx.boardId, [finding(objectId, 1, { confidence: 1.5 })]), "VALIDATION_FAILED");
    await expectCode(
      createRun(fx.owner, fx.boardId, [finding(objectId)], { action: "delete_board" }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      createRun(
        fx.owner,
        fx.boardId,
        Array.from({ length: 11 }, () => finding(objectId)),
      ),
      "VALIDATION_FAILED",
    );
  });

  it("rejects proposals that are not a new object of a supported type", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const withObject = (patch: Record<string, unknown>) =>
      finding(objectId, 1, { proposal: { kind: "create_object", object: { ...noteProposal().object, ...patch } } });
    await expectCode(createRun(fx.owner, fx.boardId, [withObject({ type: "IMAGE" })]), "VALIDATION_FAILED");
    await expectCode(createRun(fx.owner, fx.boardId, [withObject({ type: "DRAWING" })]), "VALIDATION_FAILED");
    await expectCode(
      createRun(fx.owner, fx.boardId, [withObject({ props: { text: "x".repeat(201) } })]),
      "VALIDATION_FAILED",
    );
    await expectCode(
      createRun(fx.owner, fx.boardId, [
        finding(objectId, 1, { proposal: { kind: "delete_object", object_id: objectId } }),
      ]),
      "VALIDATION_FAILED",
    );
  });

  it("rejects evidence from another board without confirming it exists", async () => {
    const other = await createBoardFixture(db);
    const { objectId } = await createNote(db, other.owner, other.boardId);
    await expectCode(createRun(fx.owner, fx.boardId, [finding(objectId)]), "VALIDATION_FAILED");
  });

  it("rejects an object context that is not on the board", async () => {
    await expectCode(createRun(fx.owner, fx.boardId, [], { kind: "object", objectId: uuid() }), "VALIDATION_FAILED");
  });

  it("lets a viewer run Find planning gaps but not Propose a plan", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    expect(await createRun(fx.viewer, fx.boardId, [finding(objectId)])).toHaveLength(1);
    await expectCode(
      createRun(fx.viewer, fx.boardId, [finding(objectId)], { action: "propose_plan" }),
      "BOARD_ACCESS_DENIED",
    );
  });

  it("does not reveal boards to people who are not members", async () => {
    await expectCode(createRun(fx.outsider, fx.boardId, []), "BOARD_NOT_FOUND");
  });

  it("expires the previous pending proposals from the same person", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const [first] = await createRun(fx.owner, fx.boardId, [finding(objectId)]);
    await createRun(fx.owner, fx.boardId, [finding(objectId)]);
    const rows = await db.admin<{ status: string }>("select status from public.assistant_proposals where id = $1", [
      first.id,
    ]);
    expect(rows[0].status).toBe("expired");
  });

  it("rate-limits runs per board", async () => {
    for (let i = 0; i < 10; i += 1) await createRun(fx.owner, fx.boardId, []);
    await expectCode(createRun(fx.owner, fx.boardId, []), "RATE_LIMITED");
  });
});

describe("editing and rejecting", () => {
  it("lets an editor edit and reject only their own pending proposal", async () => {
    const { proposal } = await proposalFor(fx.editor);
    const edited = await db.rpc<ProposalRow>(fx.editor, "assistant_edit_proposal", {
      p_proposal_id: proposal.id,
      p_proposal: noteProposal("Decide: Who owns onboarding and billing"),
    });
    expect(edited.status).toBe("pending");
    expect(edited.edited_proposal).toBeTruthy();
    const rejected = await db.rpc<ProposalRow>(fx.editor, "assistant_reject_proposal", { p_proposal_id: proposal.id });
    expect(rejected.status).toBe("rejected");
    await expectCode(
      db.rpc(fx.editor, "assistant_edit_proposal", { p_proposal_id: proposal.id, p_proposal: noteProposal() }),
      "PROPOSAL_NOT_PENDING",
    );
  });

  it("does not let anyone change another person's proposal", async () => {
    const { proposal } = await proposalFor(fx.editor);
    await expectCode(
      db.rpc(fx.owner, "assistant_reject_proposal", { p_proposal_id: proposal.id }),
      "PROPOSAL_NOT_FOUND",
    );
    await expectCode(
      db.rpc(fx.owner, "assistant_edit_proposal", { p_proposal_id: proposal.id, p_proposal: noteProposal() }),
      "PROPOSAL_NOT_FOUND",
    );
    await expectCode(
      db.rpc(fx.outsider, "assistant_reject_proposal", { p_proposal_id: proposal.id }),
      "PROPOSAL_NOT_FOUND",
    );
  });

  it("does not let a viewer edit or reject, even their own", async () => {
    const { proposal } = await proposalFor(fx.viewer);
    await expectCode(
      db.rpc(fx.viewer, "assistant_reject_proposal", { p_proposal_id: proposal.id }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      db.rpc(fx.viewer, "assistant_edit_proposal", { p_proposal_id: proposal.id, p_proposal: noteProposal() }),
      "BOARD_ACCESS_DENIED",
    );
  });

  it("validates an edit like a new proposal", async () => {
    const { proposal } = await proposalFor();
    await expectCode(
      db.rpc(fx.owner, "assistant_edit_proposal", {
        p_proposal_id: proposal.id,
        p_proposal: { kind: "create_object", object: { ...noteProposal().object, type: "IMAGE" } },
      }),
      "VALIDATION_FAILED",
    );
  });

  it("records a rejected event and does not touch the board", async () => {
    const { proposal } = await proposalFor();
    const before = await objectCount();
    const [{ last_sequence }] = await db.admin<{ last_sequence: string }>(
      "select last_sequence from public.boards where id = $1",
      [fx.boardId],
    );
    await db.rpc(fx.owner, "assistant_reject_proposal", { p_proposal_id: proposal.id });
    expect(await events(proposal.id)).toEqual(["generated", "rejected"]);
    expect(await objectCount()).toBe(before);
    const [after] = await db.admin<{ last_sequence: string }>("select last_sequence from public.boards where id = $1", [
      fx.boardId,
    ]);
    expect(after.last_sequence).toBe(last_sequence);
  });

  it("keeps events append-only", async () => {
    const { proposal } = await proposalFor();
    await expect(
      db.admin("update public.assistant_proposal_events set event = 'rejected' where proposal_id = $1", [proposal.id]),
    ).rejects.toThrow(/ASSISTANT_EVENTS_APPEND_ONLY/);
    await expectDenied(db.queryAs(fx.owner, "delete from public.assistant_proposal_events"));
    await expectDenied(db.queryAs(fx.owner, "update public.assistant_proposal_events set event = 'viewed'"));
  });

  it("records a viewed event once", async () => {
    const { proposal } = await proposalFor();
    await db.rpc(fx.owner, "assistant_mark_viewed", { p_proposal_id: proposal.id });
    await db.rpc(fx.owner, "assistant_mark_viewed", { p_proposal_id: proposal.id });
    expect(await events(proposal.id)).toEqual(["generated", "viewed"]);
  });
});

describe("accepting", () => {
  it("creates one note through the normal operation path", async () => {
    const { proposal } = await proposalFor();
    const before = await objectCount();
    const result = await accept(fx.owner, proposal.id);
    expect(result.status).toBe("applied");
    expect(result.proposal.status).toBe("accepted");
    expect(result.operation?.object.props.text).toBe("Decide: Who owns onboarding");
    expect(await objectCount()).toBe(before + 1);

    const operations = await db.admin<{ actor_id: string; operation_type: string }>(
      "select actor_id, operation_type from public.board_operations where operation_id = $1",
      [result.operation?.operation_id],
    );
    expect(operations).toEqual([{ actor_id: fx.owner.id, operation_type: "OBJECT_CREATED" }]);
    const activity = await db.admin<{ n: number }>(
      "select count(*)::int as n from public.board_activity where board_id = $1 and type = 'OBJECT_CREATED' and object_id = $2",
      [fx.boardId, result.operation?.object.id],
    );
    expect(activity[0].n).toBe(1);
    const broadcast = await db.admin<{ n: number }>(
      "select count(*)::int as n from realtime.messages where topic = $1",
      [`board:${fx.boardId}:operations`],
    );
    expect(broadcast[0].n).toBeGreaterThan(0);
  });

  it("applies only once, however many times it is accepted", async () => {
    const { proposal } = await proposalFor();
    const first = await accept(fx.owner, proposal.id);
    const second = await accept(fx.owner, proposal.id);
    const third = await accept(fx.owner, proposal.id);
    expect([first.status, second.status, third.status]).toEqual(["applied", "already_applied", "already_applied"]);
    expect(second.operation?.operation_id).toBe(first.operation?.operation_id);
    const notes = await db.admin<{ n: number }>(
      "select count(*)::int as n from public.canvas_objects where board_id = $1 and props ->> 'text' = 'Decide: Who owns onboarding'",
      [fx.boardId],
    );
    expect(notes[0].n).toBe(1);
  });

  it("records generated, accepted and applied events in order", async () => {
    const { proposal } = await proposalFor();
    await accept(fx.owner, proposal.id);
    expect(await events(proposal.id)).toEqual(["generated", "accepted", "applied"]);
    const [row] = await db.admin<{ applied_operation_id: string | null; resolved_at: string | null }>(
      "select applied_operation_id, resolved_at from public.assistant_proposals where id = $1",
      [proposal.id],
    );
    expect(row.applied_operation_id).not.toBeNull();
    expect(row.resolved_at).not.toBeNull();
  });

  it("applies the edited version and marks it edited_accepted", async () => {
    const { proposal } = await proposalFor();
    await db.rpc(fx.owner, "assistant_edit_proposal", {
      p_proposal_id: proposal.id,
      p_proposal: noteProposal("Decide: Who owns onboarding this quarter"),
    });
    const result = await accept(fx.owner, proposal.id);
    expect(result.proposal.status).toBe("edited_accepted");
    expect(result.operation?.object.props.text).toBe("Decide: Who owns onboarding this quarter");
    expect(await events(proposal.id)).toEqual(["generated", "edited", "accepted", "applied"]);
  });

  it("rejects a viewer", async () => {
    const { proposal } = await proposalFor(fx.viewer);
    await expectCode(accept(fx.viewer, proposal.id), "BOARD_ACCESS_DENIED");
  });

  it("does not accept someone else's proposal or reveal it to outsiders", async () => {
    const { proposal } = await proposalFor(fx.owner);
    await expectCode(accept(fx.editor, proposal.id), "PROPOSAL_NOT_FOUND");
    await expectCode(accept(fx.outsider, proposal.id), "PROPOSAL_NOT_FOUND");
  });

  it("marks the proposal stale when the source note was edited, and applies nothing", async () => {
    const { proposal, objectId } = await proposalFor();
    await submit(db, fx.editor, fx.boardId, "OBJECT_UPDATED", objectId, { props: { fill: "#A8D8F0" } });
    const before = await objectCount();

    const result = await accept(fx.owner, proposal.id);
    expect(result.status).toBe("stale");
    expect(result.reason).toMatchObject({ object_id: objectId, reason: "changed" });
    expect(result.proposal.status).toBe("stale");
    expect(await objectCount()).toBe(before);
    expect(await events(proposal.id)).toEqual(["generated", "marked_stale"]);

    const again = await accept(fx.owner, proposal.id);
    expect(again.status).toBe("stale");
    expect(await objectCount()).toBe(before);
  });

  it("marks the proposal stale when the source note was deleted", async () => {
    const { proposal, objectId } = await proposalFor();
    await submit(db, fx.editor, fx.boardId, "OBJECT_DELETED", objectId);
    const result = await accept(fx.owner, proposal.id);
    expect(result.status).toBe("stale");
    expect(result.reason).toMatchObject({ reason: "deleted" });
  });

  it("treats a change to any evidence object, not just the target, as stale", async () => {
    const a = await createNote(db, fx.owner, fx.boardId, { props: { text: "First note" } });
    const b = await createNote(db, fx.owner, fx.boardId, { props: { text: "Second note" } });
    const [proposal] = await createRun(fx.owner, fx.boardId, [
      finding(a.objectId, 1, {
        evidence: [
          { object_id: a.objectId, version: 1, excerpt: "First note" },
          { object_id: b.objectId, version: 1, excerpt: "Second note" },
        ],
      }),
    ]);
    await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", b.objectId, { x: 500, y: 500 });
    expect((await accept(fx.owner, proposal.id)).status).toBe("stale");
  });

  it("detects staleness when the list is loaded, before anyone clicks Accept", async () => {
    const { proposal, objectId } = await proposalFor();
    await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", objectId, { x: 900, y: 900 });
    const rows = await db.rpc<ProposalRow[]>(fx.owner, "assistant_list_proposals", { p_board_id: fx.boardId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: proposal.id, status: "stale" });
  });

  it("does not apply a rejected or expired proposal", async () => {
    const { proposal } = await proposalFor();
    await db.rpc(fx.owner, "assistant_reject_proposal", { p_proposal_id: proposal.id });
    expect((await accept(fx.owner, proposal.id)).status).toBe("rejected");

    const second = await proposalFor();
    await db.admin("update public.assistant_proposals set created_at = now() - interval '8 days' where id = $1", [
      second.proposal.id,
    ]);
    expect((await accept(fx.owner, second.proposal.id)).status).toBe("expired");
  });

  it("refuses a proposal that proposes nothing", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const [row] = await createRun(fx.owner, fx.boardId, [finding(objectId, 1, { proposal: null })], {
      action: "explain_board",
    });
    await expectCode(accept(fx.owner, row.id), "VALIDATION_FAILED");
  });

  it("rate-limits acceptance", async () => {
    const { proposal } = await proposalFor();
    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_accept', now(), 60)",
      [fx.owner.id],
    );
    await expectCode(accept(fx.owner, proposal.id), "RATE_LIMITED");
    expect(await events(proposal.id)).toEqual(["generated"]);
  });

  it("records apply_failed and leaves the proposal pending when the operation fails", async () => {
    const { proposal } = await proposalFor();
    // Occupy the id the proposal would create, so the operation comes back as a conflict.
    await db.admin(
      `insert into public.canvas_objects (id, board_id, type, x, y, width, height)
       values (md5('assistant:' || $1::text || ':object')::uuid, $2, 'STICKY_NOTE', 0, 0, 100, 100)`,
      [proposal.id, fx.boardId],
    );
    const before = await objectCount();

    const result = await accept(fx.owner, proposal.id);
    expect(result.status).toBe("failed");
    expect(result.code).toBe("OBJECT_EXISTS");
    expect(result.proposal.status).toBe("pending");
    expect(result.proposal.applied_operation_id).toBeNull();
    expect(await events(proposal.id)).toEqual(["generated", "apply_failed"]);
    expect(await objectCount()).toBe(before);
  });

  it("records apply_failed when the operation itself raises", async () => {
    const { proposal } = await proposalFor();
    // Fill the board's operation allowance so submit_operation raises RATE_LIMITED.
    await db.admin(
      `insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'operation', now(), 600)
       on conflict (user_id, action) do update set hits = 600, window_start = now()`,
      [fx.owner.id],
    );
    const result = await accept(fx.owner, proposal.id);
    expect(result.status).toBe("failed");
    expect(result.code).toBe("RATE_LIMITED");
    expect(await events(proposal.id)).toEqual(["generated", "apply_failed"]);
    const [row] = await db.admin<{ status: string }>("select status from public.assistant_proposals where id = $1", [
      proposal.id,
    ]);
    expect(row.status).toBe("pending");
  });

  it("stops a removed member from accepting", async () => {
    const mine = await proposalFor(fx.editor);
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.editor.id });
    await expectCode(accept(fx.editor, mine.proposal.id), "BOARD_NOT_FOUND");
  });
});

describe("audit integrity", () => {
  const LIFECYCLE = [
    "generated",
    "viewed",
    "edited",
    "accepted",
    "rejected",
    "marked_stale",
    "apply_failed",
    "applied",
  ];

  it("does not let any member, or an anonymous caller, insert an event directly", async () => {
    const { proposal } = await proposalFor();
    for (const user of [fx.owner, fx.editor, fx.viewer, fx.outsider, null]) {
      for (const event of LIFECYCLE) {
        await expectDenied(
          db.queryAs(
            user,
            `insert into public.assistant_proposal_events (proposal_id, board_id, actor_id, event)
             values ($1, $2, $3, $4)`,
            [proposal.id, fx.boardId, user?.id ?? fx.owner.id, event],
          ),
        );
      }
    }
    expect(await events(proposal.id)).toEqual(["generated"]);
  });

  it("does not let a client call the private event writer or any private helper", async () => {
    const { proposal } = await proposalFor();
    for (const sql of [
      "select private.assistant_log_event($1, $2, 'accepted', '{}'::jsonb)",
      "select private.assistant_log_event($1, $2, 'applied', '{}'::jsonb)",
      "select private.assistant_log_event($1, $2, 'marked_stale', '{}'::jsonb)",
    ]) {
      await expectDenied(db.queryAs(fx.owner, sql, [proposal.id, fx.boardId]));
    }
    await expectDenied(db.queryAs(fx.owner, "select private.assistant_derived_uuid($1, 'object')", [proposal.id]));
    expect(await events(proposal.id)).toEqual(["generated"]);
  });

  it("grants clients SELECT on the event table and nothing else", async () => {
    const grants = await db.admin<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'assistant_proposal_events' and grantee in ('anon', 'authenticated', 'PUBLIC')
       order by privilege_type`,
    );
    expect(grants.map((g) => g.privilege_type)).toEqual(["SELECT"]);
    const columnGrants = await db.admin<{ column_name: string; privilege_type: string }>(
      `select column_name, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'assistant_proposal_events'
         and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT'`,
    );
    expect(columnGrants).toEqual([]);
  });

  it("never lets anyone choose the ordering column, not even a privileged insert", async () => {
    const { proposal } = await proposalFor();
    // Refused either for lack of INSERT or because seq is GENERATED ALWAYS, whichever Postgres checks first.
    await expect(
      db.queryAs(
        fx.owner,
        `insert into public.assistant_proposal_events (seq, proposal_id, board_id, actor_id, event)
         values (1, $1, $2, $3, 'applied')`,
        [proposal.id, fx.boardId, fx.owner.id],
      ),
    ).rejects.toThrow(/permission denied|non-DEFAULT value|generated/i);
    // seq is GENERATED ALWAYS: even the table owner cannot supply it without an explicit override.
    await expect(
      db.admin(
        `insert into public.assistant_proposal_events (seq, proposal_id, board_id, actor_id, event)
         values (1, $1, $2, $3, 'applied')`,
        [proposal.id, fx.boardId, fx.owner.id],
      ),
    ).rejects.toThrow(/generated|cannot insert/i);
    await expect(
      db.admin("update public.assistant_proposal_events set seq = 0 where proposal_id = $1", [proposal.id]),
    ).rejects.toThrow();
  });

  it("only writes accepted and applied after a real apply, and marked_stale only after a real change", async () => {
    // Accepted and applied: through the accept function only, and only once.
    const first = await proposalFor();
    await accept(fx.owner, first.proposal.id);
    await accept(fx.owner, first.proposal.id);
    expect(await events(first.proposal.id)).toEqual(["generated", "accepted", "applied"]);

    // Accepting a fresh proposal does not produce marked_stale when nothing changed.
    const second = await proposalFor(fx.owner, "Who signs off the launch?");
    await accept(fx.owner, second.proposal.id);
    expect(await events(second.proposal.id)).not.toContain("marked_stale");

    // marked_stale appears only when the evidence really changed.
    const third = await proposalFor(fx.owner, "Who books the venue?");
    await submit(db, fx.owner, fx.boardId, "OBJECT_UPDATED", third.objectId, { props: { text: "Changed" } }, 1);
    await accept(fx.owner, third.proposal.id);
    expect(await events(third.proposal.id)).toEqual(["generated", "marked_stale"]);
  });

  it("records every event as the signed-in caller, never as someone else", async () => {
    const { proposal } = await proposalFor(fx.editor);
    await db.rpc(fx.editor, "assistant_mark_viewed", { p_proposal_id: proposal.id });
    await accept(fx.editor, proposal.id);
    const actors = await db.admin<{ actor_id: string }>(
      "select distinct actor_id from public.assistant_proposal_events where proposal_id = $1",
      [proposal.id],
    );
    expect(actors).toEqual([{ actor_id: fx.editor.id }]);
  });

  it("does not let another member write events on someone else's proposal", async () => {
    const { proposal } = await proposalFor(fx.editor);
    await expectCode(db.rpc(fx.owner, "assistant_mark_viewed", { p_proposal_id: proposal.id }), "PROPOSAL_NOT_FOUND");
    await expectCode(accept(fx.owner, proposal.id), "PROPOSAL_NOT_FOUND");
    await expectCode(
      db.rpc(fx.owner, "assistant_reject_proposal", { p_proposal_id: proposal.id }),
      "PROPOSAL_NOT_FOUND",
    );
    expect(await events(proposal.id)).toEqual(["generated"]);
  });

  it("documents the boundary: a member calling create_run directly can only create their own proposals", async () => {
    // The findings come from the Server Action, which runs the rule engine. A member who calls the database
    // function directly can submit findings of their own, but they are attributed to that member, validated
    // like any other, can only propose a new object they could already create, and only they can accept it.
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const [forged] = await createRun(fx.editor, fx.boardId, [finding(objectId, 1, { title: "Made up" })]);
    const [row] = await db.admin<{ created_by: string }>(
      "select created_by from public.assistant_proposals where id = $1",
      [forged.id],
    );
    expect(row.created_by).toBe(fx.editor.id);
    await expectCode(accept(fx.owner, forged.id), "PROPOSAL_NOT_FOUND");
    await expectCode(
      createRun(fx.viewer, fx.boardId, [finding(objectId)], { action: "propose_plan" }),
      "BOARD_ACCESS_DENIED",
    );
  });
});

describe("undo and related proposals", () => {
  it("re-accepting an undone proposal never recreates its object", async () => {
    const { proposal } = await proposalFor();
    const applied = await accept(fx.owner, proposal.id);
    const objectId = applied.operation!.object.id;
    // Undo is an ordinary compensating operation from the client.
    await submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", objectId, {}, 1);
    const before = await objectCount();

    const again = await accept(fx.owner, proposal.id);
    expect(again.status).toBe("already_applied");
    expect(await objectCount()).toBe(before);
    const [object] = await db.admin<{ deleted_at: string | null }>(
      "select deleted_at from public.canvas_objects where id = $1",
      [objectId],
    );
    expect(object.deleted_at).not.toBeNull();
  });

  it("a pending proposal based on an undone Assistant object becomes stale and applies nothing", async () => {
    const { proposal } = await proposalFor();
    const applied = await accept(fx.owner, proposal.id);
    const created = applied.operation!.object;

    // A later run cites the Assistant's note as evidence.
    const [followUp] = await createRun(fx.owner, fx.boardId, [finding(created.id, 1, { title: "Follow-up" })]);
    // Then the Assistant's note is undone.
    await submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", created.id, {}, 1);
    const before = await objectCount();

    const result = await accept(fx.owner, followUp.id);
    expect(result.status).toBe("stale");
    expect(result.reason).toMatchObject({ object_id: created.id, reason: "deleted" });
    expect(await objectCount()).toBe(before);
    expect(await events(followUp.id)).toEqual(["generated", "marked_stale"]);
  });

  it("undoing the Assistant's object leaves a collaborator's later edit to another object alone", async () => {
    const { objectId: other } = await createNote(db, fx.owner, fx.boardId, { props: { text: "Budget" } });
    const { proposal } = await proposalFor();
    const applied = await accept(fx.owner, proposal.id);
    await submit(db, fx.editor, fx.boardId, "OBJECT_UPDATED", other, { props: { text: "Budget approved" } }, 1);

    await submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", applied.operation!.object.id, {}, 1);

    const [row] = await db.admin<{ text: string; deleted_at: string | null }>(
      "select props->>'text' as text, deleted_at from public.canvas_objects where id = $1",
      [other],
    );
    expect(row).toEqual({ text: "Budget approved", deleted_at: null });
  });
});

describe("rate limits cannot be sidestepped", () => {
  it("limits runs per person across all boards, whatever board is named", async () => {
    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_run', now(), 30)",
      [fx.viewer.id],
    );
    // This board's own counter is empty; the per-person limit still applies.
    await expectCode(createRun(fx.viewer, fx.boardId, []), "RATE_LIMITED");
  });

  it("counts every run against the board limit, whatever the action, context or guidance", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const variants = [
      { action: "find_planning_gaps" },
      { action: "explain_board" },
      { action: "find_planning_gaps", kind: "object", objectId },
      { action: "explain_board", guidance: "do not include billing" },
      { action: "find_planning_gaps", guidance: "skip hiring" },
    ];
    for (let i = 0; i < 10; i += 1) await createRun(fx.viewer, fx.boardId, [], variants[i % variants.length]);
    for (const variant of variants) {
      await expectCode(createRun(fx.viewer, fx.boardId, [], variant), "RATE_LIMITED");
    }
  });

  it("limits a viewer exactly like an editor", async () => {
    for (let i = 0; i < 10; i += 1) await createRun(fx.viewer, fx.boardId, []);
    await expectCode(createRun(fx.viewer, fx.boardId, []), "RATE_LIMITED");
    // Another person on the same board has their own allowance.
    await createRun(fx.editor, fx.boardId, []);
  });

  it("applies the acceptance limit per person, not per proposal", async () => {
    const a = await proposalFor(fx.owner, "First question?");
    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_accept', now(), 60)",
      [fx.owner.id],
    );
    await expectCode(accept(fx.owner, a.proposal.id), "RATE_LIMITED");
    const [fresh] = await createRun(fx.owner, fx.boardId, [finding(a.objectId)]);
    await expectCode(accept(fx.owner, fresh.id), "RATE_LIMITED");
  });
});

describe("pre-flight run check", () => {
  const check = (user: TestUser | null, action = "find_planning_gaps", boardId = fx.boardId) =>
    db.rpc<{ role: string }>(user, "assistant_check_run", { p_board_id: boardId, p_action: action });

  it("returns the caller's role without counting anything", async () => {
    expect(await check(fx.owner)).toEqual({ role: "OWNER" });
    expect(await check(fx.viewer)).toEqual({ role: "VIEWER" });
    for (let i = 0; i < 20; i += 1) await check(fx.editor);
    const rows = await db.admin("select * from private.rate_limits where user_id = $1 and action like 'assistant%'", [
      fx.editor.id,
    ]);
    expect(rows).toEqual([]);
  });

  it("refuses non-members, anonymous callers, bad actions, and viewers asking to Propose a plan", async () => {
    await expectCode(check(fx.outsider), "BOARD_NOT_FOUND");
    await expect(check(null)).rejects.toThrow();
    await expectCode(check(fx.owner, "delete_board"), "VALIDATION_FAILED");
    await expectCode(check(fx.viewer, "propose_plan"), "BOARD_ACCESS_DENIED");
    expect(await check(fx.editor, "propose_plan")).toEqual({ role: "EDITOR" });
  });

  it("says RATE_LIMITED once either run limit is used up, before any analysis happens", async () => {
    for (let i = 0; i < 10; i += 1) await createRun(fx.viewer, fx.boardId, []);
    await expectCode(check(fx.viewer), "RATE_LIMITED");
    await expectCode(check(fx.viewer, "explain_board"), "RATE_LIMITED");
    expect(await check(fx.editor)).toEqual({ role: "EDITOR" });

    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_run', now(), 30)",
      [fx.editor.id],
    );
    await expectCode(check(fx.editor), "RATE_LIMITED");
  });

  it("forgets an expired window", async () => {
    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_run', now() - interval '2 hours', 30)",
      [fx.owner.id],
    );
    expect(await check(fx.owner)).toEqual({ role: "OWNER" });
  });

  it("is the only new function a client may execute, alongside the six it already had", async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname like 'assistant%' and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "assistant_accept_proposal",
      "assistant_check_run",
      "assistant_create_run",
      "assistant_edit_proposal",
      "assistant_list_proposals",
      "assistant_mark_viewed",
      "assistant_reject_proposal",
    ]);
  });
});
