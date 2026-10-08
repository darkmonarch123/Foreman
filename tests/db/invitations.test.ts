import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, expectCode, expectStatus } from "./fixtures";
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

interface Invitation {
  id: string;
  token: string;
  expires_at: string;
}

const createInvitation = (owner: TestUser, boardId: string, email: string, role = "EDITOR") =>
  db.rpc<Invitation>(owner, "create_invitation", { p_board_id: boardId, p_email: email, p_role: role });

async function soloBoard() {
  const owner = await db.createUser();
  const board = await db.rpc<{ id: string }>(owner, "create_board", { p_title: "Solo" });
  return { owner, boardId: board.id };
}

async function roleOf(user: TestUser, boardId: string): Promise<string | null> {
  const rows = await db.admin<{ role: string }>(
    "select role from public.board_members where board_id = $1 and user_id = $2",
    [boardId, user.id],
  );
  return rows[0]?.role ?? null;
}

describe("sending invitations", () => {
  it("is owner-only and limited to EDITOR or VIEWER", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(createInvitation(fx.editor, fx.boardId, "x@example.test"), "BOARD_ACCESS_DENIED");
    await expectCode(createInvitation(fx.viewer, fx.boardId, "x@example.test"), "BOARD_ACCESS_DENIED");
    await expectCode(createInvitation(fx.outsider, fx.boardId, "x@example.test"), "BOARD_NOT_FOUND");
    await expectCode(createInvitation(fx.owner, fx.boardId, "x@example.test", "OWNER"), "INVALID_ROLE");
    await expectCode(createInvitation(fx.owner, fx.boardId, "not-an-email"), "VALIDATION_FAILED");
    await expectCode(createInvitation(fx.owner, fx.boardId, fx.owner.email), "CANNOT_INVITE_SELF");
  });

  it("stores only a hash of the token and never exposes it", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email.toUpperCase());
    expect(invitation.token).toMatch(/^[0-9a-f]{64}$/);

    const [row] = await db.admin<{ token_hash: string; invitee_email: string }>(
      "select token_hash, invitee_email from public.board_invitations where id = $1",
      [invitation.id],
    );
    expect(row.token_hash).not.toBe(invitation.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.invitee_email).toBe(invitee.email);

    // The hash column is not selectable by API roles, even by the owner.
    await expect(db.queryAs(owner, "select token_hash from public.board_invitations")).rejects.toThrow(
      /permission denied/,
    );
    const listed = await db.rpc(owner, "list_board_invitations", { p_board_id: boardId });
    expect(JSON.stringify(listed)).not.toContain(invitation.token);
    expect(JSON.stringify(listed)).not.toContain(row.token_hash);
    const activity = await db.admin("select metadata from public.board_activity where board_id = $1", [boardId]);
    expect(JSON.stringify(activity)).not.toContain(invitation.token);
    expect(JSON.stringify(activity)).not.toContain(invitee.email);
  });

  it("responds identically whether or not the email has an account", async () => {
    const { owner, boardId } = await soloBoard();
    const registered = await db.createUser();
    const a = await createInvitation(owner, boardId, registered.email);
    const b = await createInvitation(owner, boardId, "nobody-here@example.test");
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("moves a private board to invite-only and records that as a sharing change", async () => {
    const { owner, boardId } = await soloBoard();
    await createInvitation(owner, boardId, "x@example.test");
    const board = await db.rpc<{ access_mode: string }>(owner, "get_board", { p_board_id: boardId });
    expect(board.access_mode).toBe("INVITE_ONLY");

    const sharingChanges = () =>
      db.admin<{ actor_id: string; metadata: Record<string, unknown> }>(
        "select actor_id, metadata from public.board_activity where board_id = $1 and type = 'SHARING_UPDATED'",
        [boardId],
      );
    expect(await sharingChanges()).toEqual([
      { actor_id: owner.id, metadata: { access_mode: "INVITE_ONLY", reason: "INVITATION_CREATED" } },
    ]);
    // A second invitation changes nothing about sharing, so nothing more is recorded.
    await createInvitation(owner, boardId, "y@example.test");
    expect(await sharingChanges()).toHaveLength(1);
  });

  it("refuses to invite someone who is already a member", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(createInvitation(fx.owner, fx.boardId, fx.viewer.email, "EDITOR"), "MEMBER_ALREADY_EXISTS");
    await expectCode(
      createInvitation(fx.owner, fx.boardId, ` ${fx.editor.email.toUpperCase()} `, "VIEWER"),
      "MEMBER_ALREADY_EXISTS",
    );
    expect(await db.rpc(fx.owner, "list_board_invitations", { p_board_id: fx.boardId })).toHaveLength(2);
    expect(await roleOf(fx.viewer, fx.boardId)).toBe("VIEWER");
    // Someone who has left can be invited again.
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.viewer.id });
    const again = await createInvitation(fx.owner, fx.boardId, fx.viewer.email, "EDITOR");
    await expectStatus(db.rpc(fx.viewer, "accept_invitation", { p_token: again.token }), "ACCEPTED");
    expect(await roleOf(fx.viewer, fx.boardId)).toBe("EDITOR");
  });

  it("renews instead of duplicating a pending invitation", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const first = await createInvitation(owner, boardId, invitee.email, "VIEWER");
    const second = await createInvitation(owner, boardId, invitee.email, "EDITOR");
    expect(second.id).toBe(first.id);
    expect(second.token).not.toBe(first.token);

    const listed = await db.rpc<{ status: string; role: string }[]>(owner, "list_board_invitations", {
      p_board_id: boardId,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ status: "PENDING", role: "EDITOR" });
    // The replaced token no longer works.
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: first.token }), "INVITATION_UNAVAILABLE");
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: second.token }), "ACCEPTED");
    expect(await roleOf(invitee, boardId)).toBe("EDITOR");
  });
});

describe("accepting invitations", () => {
  it("creates a real membership with the invited role", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email, "EDITOR");

    const pending = await db.rpc<{ id: string; board_title: string; role: string }[]>(invitee, "list_my_invitations");
    expect(pending).toMatchObject([{ id: invitation.id, board_title: "Solo", role: "EDITOR" }]);
    // The invitee cannot open the board before accepting.
    await expectCode(db.rpc(invitee, "get_board", { p_board_id: boardId }), "BOARD_NOT_FOUND");

    const result = await db.rpc<{ status: string; board_id: string }>(invitee, "accept_invitation", {
      p_token: invitation.token,
    });
    expect(result).toMatchObject({ status: "ACCEPTED", board_id: boardId });
    expect(await roleOf(invitee, boardId)).toBe("EDITOR");
    expect(await db.rpc(invitee, "list_my_invitations")).toEqual([]);

    const types = (await db.rpc<{ type: string }[]>(owner, "get_board_activity", { p_board_id: boardId })).map(
      (a) => a.type,
    );
    expect(types).toEqual(expect.arrayContaining(["MEMBER_INVITED", "INVITATION_ACCEPTED"]));
    await expectStatus(
      db.rpc(invitee, "accept_invitation", { p_token: invitation.token }),
      "INVITATION_ALREADY_ACCEPTED",
    );
  });

  it("only works for the person it was addressed to", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const thief = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email);

    await expectStatus(db.rpc(thief, "accept_invitation", { p_token: invitation.token }), "INVITATION_UNAVAILABLE");
    await expectStatus(
      db.rpc(thief, "accept_invitation", { p_invitation_id: invitation.id }),
      "INVITATION_UNAVAILABLE",
    );
    await expectCode(db.rpc(thief, "decline_invitation", { p_invitation_id: invitation.id }), "INVITATION_UNAVAILABLE");
    expect(await roleOf(thief, boardId)).toBeNull();
    expect(await db.rpc(thief, "list_my_invitations")).toEqual([]);
    expect(await db.queryAs(thief, "select id from public.board_invitations")).toEqual([]);
    expect(await db.queryAs(invitee, "select id from public.board_invitations")).toEqual([{ id: invitation.id }]);
  });

  it("requires a verified email address", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser({ verified: false });
    const invitation = await createInvitation(owner, boardId, invitee.email);
    await expectCode(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "EMAIL_NOT_VERIFIED");
    expect(await db.rpc(invitee, "list_my_invitations")).toEqual([]);
  });

  it("rejects expired invitations", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email);
    const days = (Date.parse(invitation.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    await db.admin("update public.board_invitations set expires_at = now() - interval '1 minute' where id = $1", [
      invitation.id,
    ]);
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_EXPIRED");
    expect(await roleOf(invitee, boardId)).toBeNull();
    expect(await db.rpc(invitee, "list_my_invitations")).toEqual([]);
    const listed = await db.rpc<{ status: string }[]>(owner, "list_board_invitations", { p_board_id: boardId });
    expect(listed[0].status).toBe("EXPIRED");

    // Resending renews it with a new token.
    const renewed = await db.rpc<Invitation>(owner, "resend_invitation", { p_invitation_id: invitation.id });
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_UNAVAILABLE");
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: renewed.token }), "ACCEPTED");
    expect(await roleOf(invitee, boardId)).toBe("EDITOR");
  });

  it("rejects revoked invitations", async () => {
    const fx = await createBoardFixture(db);
    const invitee = await db.createUser();
    const invitation = await createInvitation(fx.owner, fx.boardId, invitee.email);
    await expectCode(
      db.rpc(fx.editor, "revoke_invitation", { p_invitation_id: invitation.id }),
      "INVITATION_UNAVAILABLE",
    );
    await expectCode(
      db.rpc(invitee, "revoke_invitation", { p_invitation_id: invitation.id }),
      "INVITATION_UNAVAILABLE",
    );

    await db.rpc(fx.owner, "revoke_invitation", { p_invitation_id: invitation.id });
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_REVOKED");
    expect(await roleOf(invitee, fx.boardId)).toBeNull();
    await expectCode(
      db.rpc(fx.owner, "revoke_invitation", { p_invitation_id: invitation.id }),
      "INVITATION_NOT_PENDING",
    );
    await expectCode(
      db.rpc(fx.owner, "resend_invitation", { p_invitation_id: invitation.id }),
      "INVITATION_NOT_PENDING",
    );
    const types = (await db.rpc<{ type: string }[]>(fx.owner, "get_board_activity", { p_board_id: fx.boardId })).map(
      (a) => a.type,
    );
    expect(types[0]).toBe("INVITATION_REVOKED");
  });

  it("can be declined", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email);
    await db.rpc(invitee, "decline_invitation", { p_invitation_id: invitation.id });
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_UNAVAILABLE");
    const listed = await db.rpc<{ status: string }[]>(owner, "list_board_invitations", { p_board_id: boardId });
    expect(listed[0].status).toBe("DECLINED");
    expect(await roleOf(invitee, boardId)).toBeNull();
  });

  it("upgrades someone who became a viewer after being invited as editor, but never downgrades", async () => {
    // Invited as EDITOR, then joined with the code as VIEWER before accepting.
    const { owner, boardId } = await soloBoard();
    const [{ collaboration_code: code }] = await db.admin<{ collaboration_code: string }>(
      "select collaboration_code from public.board_sharing where board_id = $1",
      [boardId],
    );
    const riser = await db.createUser();
    const up = await createInvitation(owner, boardId, riser.email, "EDITOR");
    await db.rpc(owner, "update_sharing", { p_board_id: boardId, p_access_mode: "LINK_VIEWER" });
    await expectStatus(db.rpc(riser, "join_board", { p_code: code }), "JOINED_VIEWER");
    expect(await roleOf(riser, boardId)).toBe("VIEWER");
    await expectStatus(db.rpc(riser, "accept_invitation", { p_token: up.token }), "ACCEPTED");
    expect(await roleOf(riser, boardId)).toBe("EDITOR");

    // Invited as VIEWER, then approved as EDITOR through a join request before accepting.
    const keeper = await db.createUser();
    const down = await createInvitation(owner, boardId, keeper.email, "VIEWER");
    await db.rpc(owner, "update_sharing", { p_board_id: boardId, p_access_mode: "LINK_REQUEST_ACCESS" });
    await expectStatus(db.rpc(keeper, "join_board", { p_code: code }), "REQUEST_SUBMITTED");
    const [request] = await db.rpc<{ id: string }[]>(owner, "list_join_requests", { p_board_id: boardId });
    await db.rpc(owner, "decide_join_request", { p_request_id: request.id, p_approve: true, p_role: "EDITOR" });
    await expectStatus(db.rpc(keeper, "accept_invitation", { p_token: down.token }), "ACCEPTED");
    expect(await roleOf(keeper, boardId)).toBe("EDITOR");
  });

  it("is unavailable once the board is deleted", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email);
    await db.rpc(owner, "delete_board", { p_board_id: boardId });
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_UNAVAILABLE");
    expect(await db.rpc(invitee, "list_my_invitations")).toEqual([]);
  });

  it("counts failed token guesses, so guessing is rate-limited", async () => {
    const { owner, boardId } = await soloBoard();
    const invitee = await db.createUser();
    const guesser = await db.createUser();
    const invitation = await createInvitation(owner, boardId, invitee.email);

    // Every wrong guess is answered the same way and stays on the counter.
    for (let i = 0; i < 30; i += 1) {
      const guess = `${i}`.padStart(2, "0").repeat(32);
      expect(await db.rpc(guesser, "accept_invitation", { p_token: guess })).toEqual({
        status: "INVITATION_UNAVAILABLE",
      });
    }
    const [counter] = await db.admin<{ hits: number }>(
      "select hits from private.rate_limits where user_id = $1 and action = 'invitation_response'",
      [guesser.id],
    );
    expect(counter.hits).toBe(30);

    // The 31st attempt in the window is refused before any lookup, even with a real id.
    expect(await db.rpc(guesser, "accept_invitation", { p_token: "f".repeat(64) })).toEqual({ status: "RATE_LIMITED" });
    expect(await db.rpc(guesser, "accept_invitation", { p_invitation_id: invitation.id })).toEqual({
      status: "RATE_LIMITED",
    });

    const events = await db.admin<{ event_type: string; n: number }>(
      "select event_type, count(*)::int as n from public.security_events where user_id = $1 group by 1 order by 1",
      [guesser.id],
    );
    expect(events).toEqual([
      { event_type: "INVITATION_LOOKUP_FAILED", n: 30 },
      { event_type: "INVITATION_RATE_LIMITED", n: 2 },
    ]);

    // Someone else's limit is untouched: the real invitee can still accept.
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "ACCEPTED");
    expect(await roleOf(invitee, boardId)).toBe("EDITOR");
  });
});
