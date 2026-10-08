import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectCode, expectDenied, expectStatus } from "./fixtures";
import { TestDatabase } from "./harness";

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

interface Export {
  format: string;
  profile: { id: string; email: string };
  boards: { id: string; role: string; objects: unknown[] }[];
  comments: { body: string }[];
  activity: { board_id: string }[];
}

describe("data export", () => {
  it("contains the caller's profile, accessible boards, own comments and activity", async () => {
    const fx = await createBoardFixture(db, { template: "project-roadmap" });
    const other = await createBoardFixture(db);
    await db.rpc(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "Editor's comment" });
    await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "Owner's comment" });
    await db.rpc(other.owner, "add_comment", { p_board_id: other.boardId, p_body: "Unrelated secret" });

    const data = await db.rpc<Export>(fx.editor, "export_my_data");
    expect(data.format).toBe("foreman-export-v1");
    expect(data.profile).toMatchObject({ id: fx.editor.id, email: fx.editor.email });
    expect(data.boards.map((b) => [b.id, b.role])).toEqual([[fx.boardId, "EDITOR"]]);
    expect(data.boards[0].objects.length).toBeGreaterThan(0);
    expect(data.comments.map((c) => c.body)).toEqual(["Editor's comment"]);
    expect(new Set(data.activity.map((a) => a.board_id))).toEqual(new Set([fx.boardId]));

    const dump = JSON.stringify(data);
    expect(dump).not.toContain("Unrelated secret");
    expect(dump).not.toContain(other.boardId);
    expect(dump).not.toContain(fx.owner.email);
    expect(dump).not.toContain("token");
  });

  it("is rate-limited", async () => {
    const user = await db.createUser();
    for (let i = 0; i < 5; i += 1) await db.rpc(user, "export_my_data");
    await expectCode(db.rpc(user, "export_my_data"), "RATE_LIMITED");
  });
});

describe("account deletion", () => {
  it("requires the exact confirmation phrase", async () => {
    const user = await db.createUser();
    await expectCode(
      db.rpc(user, "request_account_deletion", { p_confirmation: "delete my account" }),
      "CONFIRMATION_MISMATCH",
    );
    await expectCode(db.rpc(user, "request_account_deletion", { p_confirmation: null }), "CONFIRMATION_MISMATCH");
    const [profile] = await db.admin<{ status: string }>("select status from public.profiles where id = $1", [user.id]);
    expect(profile.status).toBe("ACTIVE");
  });

  it("requires shared boards the user owns to be resolved first", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.owner, "request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" }),
      "OWNED_BOARDS_REQUIRE_TRANSFER",
    );
    await db.rpc(fx.owner, "transfer_ownership", { p_board_id: fx.boardId, p_new_owner_id: fx.editor.id });
    await db.rpc(fx.owner, "request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" });

    const [profile] = await db.admin<{ status: string; deleted_at: string | null }>(
      "select status, deleted_at from public.profiles where id = $1",
      [fx.owner.id],
    );
    expect(profile.status).toBe("PENDING_DELETION");
    expect(profile.deleted_at).not.toBeNull();
    // The board lives on with its new owner; the departing user is no longer on it.
    const members = await db.rpc<{ user_id: string; role: string }[]>(fx.editor, "get_board_members", {
      p_board_id: fx.boardId,
    });
    expect(members.map((m) => m.user_id)).not.toContain(fx.owner.id);
    expect(members.find((m) => m.user_id === fx.editor.id)?.role).toBe("OWNER");
  });

  it("soft-deletes solo boards and blocks further collaboration", async () => {
    const user = await db.createUser();
    const board = await db.rpc<{ id: string }>(user, "create_board", { p_title: "Solo" });
    await createNote(db, user, board.id);
    await db.rpc(user, "request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" });

    const [row] = await db.admin<{ deleted_at: string | null }>("select deleted_at from public.boards where id = $1", [
      board.id,
    ]);
    expect(row.deleted_at).not.toBeNull();
    await expectCode(db.rpc(user, "create_board", { p_title: "Another" }), "ACCOUNT_INACTIVE");
    await expectCode(db.rpc(user, "restore_board", { p_board_id: board.id }), "ACCOUNT_INACTIVE");
    await expectCode(
      db.rpc(user, "update_profile", { p_first_name: "A", p_last_name: "B", p_username: "still_here" }),
      "ACCOUNT_INACTIVE",
    );
    const events = await db.admin<{ event_type: string }>(
      "select event_type from public.security_events where user_id = $1",
      [user.id],
    );
    expect(events.map((e) => e.event_type)).toContain("ACCOUNT_DELETION_REQUESTED");
  });

  it("revokes invitations the user sent", async () => {
    const user = await db.createUser();
    const invitee = await db.createUser();
    const board = await db.rpc<{ id: string }>(user, "create_board", { p_title: "Solo" });
    const invitation = await db.rpc<{ token: string }>(user, "create_invitation", {
      p_board_id: board.id,
      p_email: invitee.email,
      p_role: "EDITOR",
    });
    await db.rpc(user, "request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" });
    await expectStatus(db.rpc(invitee, "accept_invitation", { p_token: invitation.token }), "INVITATION_UNAVAILABLE");
  });
});

describe("cookie consent and notification preferences", () => {
  it("stores consent with a version and timestamp, readable only by its owner", async () => {
    const user = await db.createUser();
    const other = await db.createUser();
    await db.rpc(user, "record_cookie_consent", { p_version: "2026-10", p_analytics: false, p_preferences: true });
    const mine = await db.queryAs<{
      consent_version: string;
      analytics: boolean;
      preferences: boolean;
      created_at: string;
    }>(user, "select consent_version, analytics, preferences, created_at from public.cookie_consents");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ consent_version: "2026-10", analytics: false, preferences: true });
    expect(mine[0].created_at).toBeTruthy();
    expect(await db.queryAs(other, "select * from public.cookie_consents")).toEqual([]);
    await expectDenied(
      db.queryAs(other, "insert into public.cookie_consents (user_id, consent_version) values ($1, 'x')", [user.id]),
    );
    await expectDenied(
      db.rpc(null, "record_cookie_consent", { p_version: "x", p_analytics: true, p_preferences: true }),
    );
  });

  it("stores only known boolean notification preferences", async () => {
    const user = await db.createUser();
    const prefs = await db.rpc(user, "update_notification_prefs", {
      p_prefs: { invitations: false, comments: true, is_admin: true, plan: "PRO", join_requests: "yes" },
    });
    expect(prefs).toEqual({ invitations: false, comments: true });
  });

  it("does not let an account that is pending deletion change its preferences", async () => {
    const user = await db.createUser();
    await db.rpc(user, "update_notification_prefs", { p_prefs: { comments: false } });
    await db.rpc(user, "request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" });
    await expectCode(
      db.rpc(user, "update_notification_prefs", { p_prefs: { comments: true, product_updates: true } }),
      "ACCOUNT_INACTIVE",
    );
    const [profile] = await db.admin<{ notification_prefs: Record<string, boolean> }>(
      "select notification_prefs from public.profiles where id = $1",
      [user.id],
    );
    expect(profile.notification_prefs).toEqual({ comments: false });
  });
});

describe("function exposure", () => {
  it("exposes no private helper to API roles", async () => {
    const user = await db.createUser();
    for (const call of [
      "select private.log_activity(gen_random_uuid(), 'BOARD_CREATED')",
      "select private.broadcast(gen_random_uuid(), 'operations', 'operation', '{}')",
      "select private.random_token()",
      "select private.enforce_rate_limit('x', 1, interval '1 minute')",
      "select private.snapshot_board(gen_random_uuid(), 0)",
      "select private.log_security_event('X')",
      "select * from private.rate_limits",
      "select * from private.settings",
    ]) {
      await expectDenied(db.queryAs(user, call));
    }
  });

  it("defines no unused role helper", async () => {
    // private.board_role was never called by any function or policy and has been removed;
    // private.require_board_role is the one role check.
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname like '%board_role' order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual(["require_board_role"]);
  });

  it("grants anonymous callers exactly one function", async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual(["username_available"]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("has row level security enabled on every application table", async () => {
    const rows = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("has no always-true policy on private data", async () => {
    const rows = await db.admin<{ tablename: string; qual: string }>(
      `select tablename, qual from pg_policies
       where schemaname in ('public', 'realtime') and (qual = 'true' or with_check = 'true')`,
    );
    expect(rows).toEqual([]);
  });

  it("gives API roles no write privilege on any table", async () => {
    const rows = await db.admin<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated')
         and privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });
});
