import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, expectCode } from "./fixtures";
import { TestDatabase, type TestUser } from "./harness";

let db: TestDatabase;
beforeAll(async () => {
  db = await TestDatabase.create();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.admin("truncate private.rate_limits");
});

interface JoinResult {
  status: string;
  board_id?: string;
}

const join = (user: TestUser, args: { p_code?: string; p_token?: string }) =>
  db.rpc<JoinResult>(user, "join_board", args);

async function roleOf(user: TestUser, boardId: string): Promise<string | null> {
  const rows = await db.admin<{ role: string }>(
    "select role from public.board_members where board_id = $1 and user_id = $2",
    [boardId, user.id],
  );
  return rows[0]?.role ?? null;
}

describe("collaboration codes", () => {
  it("never reveal a private or invite-only board", async () => {
    const fx = await createBoardFixture(db);
    const stranger = await db.createUser();
    const privateBoard = await join(stranger, { p_code: fx.code });
    const missing = await join(stranger, { p_code: "F-ZZZ-9999" });
    const malformed = await join(stranger, { p_code: "not a code" });
    // Identical responses: a hidden board is indistinguishable from a missing one.
    expect(privateBoard).toEqual({ status: "UNAVAILABLE" });
    expect(missing).toEqual(privateBoard);
    expect(malformed).toEqual(privateBoard);
    expect(await roleOf(stranger, fx.boardId)).toBeNull();
  });

  it("are normalised: trimmed and upper-cased", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" });
    const stranger = await db.createUser();
    const result = await join(stranger, { p_code: `  ${fx.code.toLowerCase()}\n` });
    expect(result).toEqual({ status: "JOINED_VIEWER", board_id: fx.boardId });
    expect(
      await db.rpc(null as never, "normalize_collaboration_code", { p_code: " f-1we-23xx " }).catch(() => "denied"),
    ).toBe("denied");
    expect(await db.rpc(stranger, "normalize_collaboration_code", { p_code: " f-1we-23xx " })).toBe("F-1WE-23XX");
  });

  it("grant VIEWER at most, never EDITOR", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" });
    const stranger = await db.createUser();
    await join(stranger, { p_code: fx.code });
    expect(await roleOf(stranger, fx.boardId)).toBe("VIEWER");
    // Joining again changes nothing.
    expect(await join(stranger, { p_code: fx.code })).toEqual({ status: "ALREADY_MEMBER", board_id: fx.boardId });
    expect(await roleOf(stranger, fx.boardId)).toBe("VIEWER");
    // An existing editor is not downgraded by using the code.
    expect((await join(fx.editor, { p_code: fx.code })).status).toBe("ALREADY_MEMBER");
    expect(await roleOf(fx.editor, fx.boardId)).toBe("EDITOR");
  });

  it("create a join request that the owner must approve", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_REQUEST_ACCESS" });
    const stranger = await db.createUser();

    expect(await join(stranger, { p_code: fx.code })).toEqual({ status: "REQUEST_SUBMITTED" });
    expect(await roleOf(stranger, fx.boardId)).toBeNull();
    await expectCode(db.rpc(stranger, "get_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    expect(await join(stranger, { p_code: fx.code })).toEqual({ status: "PENDING_APPROVAL" });

    // Only the owner sees and decides requests.
    await expectCode(db.rpc(fx.editor, "list_join_requests", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
    const requests = await db.rpc<{ id: string; user_id: string }[]>(fx.owner, "list_join_requests", {
      p_board_id: fx.boardId,
    });
    expect(requests.map((r) => r.user_id)).toEqual([stranger.id]);
    expect(JSON.stringify(requests)).not.toContain("@");
    await expectCode(
      db.rpc(fx.editor, "decide_join_request", { p_request_id: requests[0].id, p_approve: true }),
      "JOIN_REQUEST_NOT_FOUND",
    );
    await expectCode(
      db.rpc(stranger, "decide_join_request", { p_request_id: requests[0].id, p_approve: true, p_role: "EDITOR" }),
      "JOIN_REQUEST_NOT_FOUND",
    );
    await expectCode(
      db.rpc(fx.owner, "decide_join_request", { p_request_id: requests[0].id, p_approve: true, p_role: "OWNER" }),
      "INVALID_ROLE",
    );

    const notifications = await db.rpc<{ join_requests: { id: string }[] }>(fx.owner, "get_notifications");
    expect(notifications.join_requests.map((r) => r.id)).toEqual([requests[0].id]);

    await db.rpc(fx.owner, "decide_join_request", { p_request_id: requests[0].id, p_approve: true });
    expect(await roleOf(stranger, fx.boardId)).toBe("VIEWER");
    // A decided request cannot be replayed to change the outcome.
    await expectCode(
      db.rpc(fx.owner, "decide_join_request", { p_request_id: requests[0].id, p_approve: true, p_role: "EDITOR" }),
      "JOIN_REQUEST_NOT_FOUND",
    );
    expect(await roleOf(stranger, fx.boardId)).toBe("VIEWER");
  });

  it("report ACCESS_DENIED after a recent rejection", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_REQUEST_ACCESS" });
    const stranger = await db.createUser();
    await join(stranger, { p_code: fx.code });
    const [request] = await db.rpc<{ id: string }[]>(fx.owner, "list_join_requests", { p_board_id: fx.boardId });
    await db.rpc(fx.owner, "decide_join_request", { p_request_id: request.id, p_approve: false });
    expect(await join(stranger, { p_code: fx.code })).toEqual({ status: "ACCESS_DENIED" });
    expect(await roleOf(stranger, fx.boardId)).toBeNull();
    // The requester can see their own request, and only their own.
    const mine = await db.queryAs<{ status: string }>(stranger, "select status from public.board_join_requests");
    expect(mine).toEqual([{ status: "REJECTED" }]);
  });

  it("stop working when disabled or regenerated", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", {
      p_board_id: fx.boardId,
      p_access_mode: "LINK_VIEWER",
      p_code_enabled: false,
    });
    const a = await db.createUser();
    expect(await join(a, { p_code: fx.code })).toEqual({ status: "UNAVAILABLE" });

    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_code_enabled: true });
    await expectCode(
      db.rpc(fx.editor, "regenerate_collaboration_code", { p_board_id: fx.boardId }),
      "BOARD_ACCESS_DENIED",
    );
    const fresh = await db.rpc<string>(fx.owner, "regenerate_collaboration_code", { p_board_id: fx.boardId });
    expect(fresh).not.toBe(fx.code);
    expect(await join(a, { p_code: fx.code })).toEqual({ status: "UNAVAILABLE" });
    expect((await join(a, { p_code: fresh })).status).toBe("JOINED_VIEWER");
  });

  it("are unavailable for deleted boards and unverified users", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" });
    const unverified = await db.createUser({ verified: false });
    await expectCode(join(unverified, { p_code: fx.code }), "EMAIL_NOT_VERIFIED");
    await db.rpc(fx.owner, "delete_board", { p_board_id: fx.boardId });
    expect(await join(await db.createUser(), { p_code: fx.code })).toEqual({ status: "UNAVAILABLE" });
  });

  it("rate-limit lookups and record the failures as security events", async () => {
    const stranger = await db.createUser();
    for (let i = 0; i < 10; i += 1) {
      expect(await join(stranger, { p_code: "F-AAA-AAAA" })).toEqual({ status: "UNAVAILABLE" });
    }
    expect(await join(stranger, { p_code: "F-AAA-AAAA" })).toEqual({ status: "RATE_LIMITED" });
    const events = await db.admin<{ event_type: string; n: number }>(
      "select event_type, count(*)::int as n from public.security_events where user_id = $1 group by 1 order by 1",
      [stranger.id],
    );
    expect(events).toEqual([
      { event_type: "JOIN_LOOKUP_FAILED", n: 10 },
      { event_type: "JOIN_RATE_LIMITED", n: 1 },
    ]);
  });
});

describe("share links", () => {
  it("are generated once, stored only as a hash, and join as viewer", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" });
    await expectCode(db.rpc(fx.editor, "regenerate_share_link", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
    const token = await db.rpc<string>(fx.owner, "regenerate_share_link", { p_board_id: fx.boardId });
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const stored = await db.admin<{ share_token_hash: string }>(
      "select share_token_hash from public.board_sharing where board_id = $1",
      [fx.boardId],
    );
    expect(stored[0].share_token_hash).not.toBe(token);
    expect(JSON.stringify(await db.rpc(fx.owner, "get_sharing", { p_board_id: fx.boardId }))).not.toContain(token);
    const activity = await db.admin<{ metadata: unknown }>(
      "select metadata from public.board_activity where board_id = $1",
      [fx.boardId],
    );
    expect(JSON.stringify(activity)).not.toContain(token);

    const stranger = await db.createUser();
    expect(await join(stranger, { p_token: token })).toEqual({ status: "JOINED_VIEWER", board_id: fx.boardId });
    expect(await roleOf(stranger, fx.boardId)).toBe("VIEWER");
  });

  it("stop working when regenerated or disabled", async () => {
    const fx = await createBoardFixture(db);
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" });
    const first = await db.rpc<string>(fx.owner, "regenerate_share_link", { p_board_id: fx.boardId });
    const second = await db.rpc<string>(fx.owner, "regenerate_share_link", { p_board_id: fx.boardId });
    const a = await db.createUser();
    expect(await join(a, { p_token: first })).toEqual({ status: "UNAVAILABLE" });

    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_share_link_enabled: false });
    expect(await join(a, { p_token: second })).toEqual({ status: "UNAVAILABLE" });

    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_share_link_enabled: true });
    expect((await join(a, { p_token: second })).status).toBe("JOINED_VIEWER");

    const types = (await db.rpc<{ type: string }[]>(fx.owner, "get_board_activity", { p_board_id: fx.boardId })).map(
      (entry) => entry.type,
    );
    expect(types).toEqual(
      expect.arrayContaining(["SHARE_LINK_ENABLED", "SHARE_LINK_DISABLED", "SHARE_LINK_REGENERATED"]),
    );
  });

  it("cannot be enabled before a link exists, and do not bypass the access mode", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_share_link_enabled: true }),
      "SHARE_LINK_NOT_GENERATED",
    );
    // INVITE_ONLY board: even a valid, enabled link grants nothing.
    const token = await db.rpc<string>(fx.owner, "regenerate_share_link", { p_board_id: fx.boardId });
    const stranger = await db.createUser();
    expect(await join(stranger, { p_token: token })).toEqual({ status: "UNAVAILABLE" });
    expect(await roleOf(stranger, fx.boardId)).toBeNull();
  });
});

describe("sharing settings", () => {
  it("are owner-only", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.editor, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      db.rpc(fx.outsider, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "LINK_VIEWER" }),
      "BOARD_NOT_FOUND",
    );
    await expectCode(
      db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "EVERYONE" }),
      "VALIDATION_FAILED",
    );
  });

  it("only allow PRIVATE when nobody else is on the board", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_access_mode: "PRIVATE" }),
      "BOARD_HAS_MEMBERS",
    );
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.editor.id });
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.viewer.id });
    await db.rpc(fx.owner, "create_invitation", {
      p_board_id: fx.boardId,
      p_email: "later@example.test",
      p_role: "VIEWER",
    });

    const sharing = await db.rpc<{ access_mode: string }>(fx.owner, "update_sharing", {
      p_board_id: fx.boardId,
      p_access_mode: "PRIVATE",
    });
    expect(sharing.access_mode).toBe("PRIVATE");
    const invitations = await db.rpc<{ status: string }[]>(fx.owner, "list_board_invitations", {
      p_board_id: fx.boardId,
    });
    expect(invitations.find((i) => i.status === "PENDING")).toBeUndefined();
  });

  it("record every invitation and join request withdrawn by going private", async () => {
    const owner = await db.createUser();
    const board = await db.rpc<{ id: string; collaboration_code: string }>(owner, "create_board", {
      p_title: "Soon private",
      p_access_mode: "LINK_REQUEST_ACCESS",
    });
    for (const email of ["one@example.test", "two@example.test"]) {
      await db.rpc(owner, "create_invitation", { p_board_id: board.id, p_email: email, p_role: "VIEWER" });
    }
    const asker = await db.createUser();
    expect(await join(asker, { p_code: board.collaboration_code })).toEqual({ status: "REQUEST_SUBMITTED" });

    await db.rpc(owner, "update_sharing", { p_board_id: board.id, p_access_mode: "PRIVATE" });

    const recorded = await db.admin<{ type: string; actor_id: string; metadata: Record<string, unknown> }>(
      `select type, actor_id, metadata from public.board_activity
       where board_id = $1 and type in ('INVITATION_REVOKED', 'JOIN_REQUEST_REJECTED', 'SHARING_UPDATED')
       order by type, created_at`,
      [board.id],
    );
    expect(recorded).toEqual([
      { type: "INVITATION_REVOKED", actor_id: owner.id, metadata: { reason: "BOARD_MADE_PRIVATE" } },
      { type: "INVITATION_REVOKED", actor_id: owner.id, metadata: { reason: "BOARD_MADE_PRIVATE" } },
      {
        type: "JOIN_REQUEST_REJECTED",
        actor_id: owner.id,
        metadata: { user_id: asker.id, reason: "BOARD_MADE_PRIVATE" },
      },
      { type: "SHARING_UPDATED", actor_id: owner.id, metadata: { access_mode: "PRIVATE" } },
    ]);
    // The feed names the person whose request was rejected, as it does for a single rejection.
    const feed = await db.rpc<{ type: string; subject_name: string | null }[]>(owner, "get_board_activity", {
      p_board_id: board.id,
    });
    expect(feed.find((item) => item.type === "JOIN_REQUEST_REJECTED")?.subject_name).toMatch(/^First\d+ Last\d+$/);

    const requests = await db.admin<{ status: string; decided_by: string }>(
      "select status, decided_by from public.board_join_requests where board_id = $1",
      [board.id],
    );
    expect(requests).toEqual([{ status: "REJECTED", decided_by: owner.id }]);

    // Setting PRIVATE again withdraws nothing, so nothing more is recorded.
    await db.rpc(owner, "update_sharing", { p_board_id: board.id, p_access_mode: "PRIVATE" });
    const count = await db.admin<{ n: number }>(
      "select count(*)::int as n from public.board_activity where board_id = $1 and type = 'INVITATION_REVOKED'",
      [board.id],
    );
    expect(count[0].n).toBe(2);
  });
});
