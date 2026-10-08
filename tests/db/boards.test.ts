import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BoardState } from "@/lib/board/types";
import { createBoardFixture, createNote, expectCode, expectDenied, invite } from "./fixtures";
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

interface BoardRow {
  id: string;
  title: string;
  role: string;
  member_count: number;
  members: { user_id: string }[];
  preview: unknown[];
  deleted_at: string | null;
}

describe("board creation", () => {
  it("creates a persisted board from the Project Roadmap template", async () => {
    const owner = await db.createUser();
    const created = await db.rpc<{ id: string; collaboration_code: string }>(owner, "create_board", {
      p_title: "  Foreman Launch Plan ",
      p_template_slug: "project-roadmap",
    });
    expect(created.collaboration_code).toMatch(/^F-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}$/);

    const state = await db.rpc<BoardState>(owner, "load_board_state", { p_board_id: created.id });
    expect(state.board).toMatchObject({ title: "Foreman Launch Plan", role: "OWNER", access_mode: "PRIVATE" });
    expect(state.snapshot.sequence).toBe(0);
    expect(state.operations).toEqual([]);
    const headings = state.snapshot.objects.filter((o) => o.type === "TEXT").map((o) => o.props.text);
    expect(headings).toEqual(expect.arrayContaining(["Plan", "Build", "Test"]));

    const activity = await db.rpc<{ type: string; actor_id: string }[]>(owner, "get_board_activity", {
      p_board_id: created.id,
    });
    expect(activity.map((a) => a.type).sort()).toEqual(["BOARD_CREATED", "TEMPLATE_APPLIED"]);
    expect(activity.every((a) => a.actor_id === owner.id)).toBe(true);
  });

  it("generates unique collaboration codes", async () => {
    const owner = await db.createUser();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const board = await db.rpc<{ collaboration_code: string }>(owner, "create_board", { p_title: `Board ${i}` });
      codes.add(board.collaboration_code);
    }
    expect(codes.size).toBe(20);
    await expect(
      db.admin(
        `update public.board_sharing set collaboration_code = $1
         where board_id = (select board_id from public.board_sharing where collaboration_code <> $1 limit 1)`,
        [[...codes][0]],
      ),
    ).rejects.toThrow(/unique/);
  });

  it("requires a verified email address", async () => {
    const unverified = await db.createUser({ verified: false });
    await expectCode(db.rpc(unverified, "create_board", { p_title: "Nope" }), "EMAIL_NOT_VERIFIED");
  });

  it("validates the title, access mode and template", async () => {
    const owner = await db.createUser();
    await expectCode(db.rpc(owner, "create_board", { p_title: "   " }), "VALIDATION_FAILED");
    await expectCode(db.rpc(owner, "create_board", { p_title: "x".repeat(121) }), "VALIDATION_FAILED");
    await expectCode(db.rpc(owner, "create_board", { p_title: "x", p_access_mode: "PUBLIC" }), "VALIDATION_FAILED");
    await expectCode(db.rpc(owner, "create_board", { p_title: "x", p_template_slug: "missing" }), "TEMPLATE_NOT_FOUND");
  });

  it("enforces template plan entitlements", async () => {
    await db.admin(
      `insert into public.templates (slug, name, category, min_plan, content)
       values ('plus-only-test', 'Plus only', 'PLANNING', 'PLUS', '[]')`,
    );
    const free = await db.createUser();
    await expectCode(
      db.rpc(free, "create_board", { p_title: "x", p_template_slug: "plus-only-test" }),
      "PLAN_REQUIRED",
    );

    const plus = await db.createUser();
    await db.admin("update public.profiles set plan = 'PLUS' where id = $1", [plus.id]);
    const board = await db.rpc<{ id: string }>(plus, "create_board", {
      p_title: "x",
      p_template_slug: "plus-only-test",
    });
    expect(board.id).toBeTruthy();
  });

  it("rate-limits board creation", async () => {
    const owner = await db.createUser();
    for (let i = 0; i < 30; i += 1) {
      await db.rpc(owner, "create_board", { p_title: `Board ${i}` });
    }
    await expectCode(db.rpc(owner, "create_board", { p_title: "One too many" }), "RATE_LIMITED");
  });
});

describe("board access", () => {
  it("lists boards by scope with the caller's role and real members", async () => {
    const fx = await createBoardFixture(db, { title: "Shared plan", template: "project-roadmap" });
    await db.rpc(fx.editor, "create_board", { p_title: "Editor's own" });

    const mine = await db.rpc<BoardRow[]>(fx.editor, "list_boards", { p_scope: "mine" });
    expect(mine.map((b) => b.title)).toEqual(["Editor's own"]);

    const shared = await db.rpc<BoardRow[]>(fx.editor, "list_boards", { p_scope: "shared" });
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ title: "Shared plan", role: "EDITOR", member_count: 3 });
    expect(shared[0].members.map((m) => m.user_id)).toEqual([fx.owner.id, fx.editor.id, fx.viewer.id]);
    expect(shared[0].preview.length).toBeGreaterThan(0);

    const found = await db.rpc<BoardRow[]>(fx.editor, "list_boards", { p_search: "shared" });
    expect(found.map((b) => b.title)).toEqual(["Shared plan"]);

    expect(await db.rpc<BoardRow[]>(fx.outsider, "list_boards")).toEqual([]);
  });

  it("hides a private board from non-members without confirming it exists", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(db.rpc(fx.outsider, "get_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await expectCode(db.rpc(fx.outsider, "load_board_state", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await expectCode(db.rpc(fx.outsider, "get_board_members", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await expectCode(
      db.rpc(fx.outsider, "get_board", { p_board_id: "00000000-0000-4000-8000-000000000000" }),
      "BOARD_NOT_FOUND",
    );

    for (const table of [
      "boards",
      "board_members",
      "canvas_objects",
      "board_operations",
      "board_snapshots",
      "board_comments",
      "board_activity",
      "board_sharing",
      "board_join_requests",
    ]) {
      const rows = await db.queryAs(fx.outsider, `select * from public.${table}`);
      expect(rows, table).toEqual([]);
    }
    expect(await db.queryAs(fx.outsider, "select id from public.board_invitations")).toEqual([]);
  });

  it("lets members read board rows but never the sharing secrets", async () => {
    const fx = await createBoardFixture(db);
    expect(await db.queryAs(fx.viewer, "select id from public.boards")).toEqual([{ id: fx.boardId }]);
    expect(await db.queryAs(fx.viewer, "select * from public.board_sharing")).toEqual([]);
    expect(await db.queryAs(fx.editor, "select * from public.board_sharing")).toEqual([]);
    expect(await db.queryAs(fx.owner, "select collaboration_code from public.board_sharing")).toEqual([
      { collaboration_code: fx.code },
    ]);
    await expectCode(db.rpc(fx.editor, "get_sharing", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
  });

  it("refuses every direct table write, whatever the role", async () => {
    const fx = await createBoardFixture(db);
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    for (const user of [fx.owner, fx.editor, fx.viewer, fx.outsider]) {
      await expectDenied(db.queryAs(user, "update public.boards set title = 'hijacked'"));
      await expectDenied(db.queryAs(user, "delete from public.boards"));
      await expectDenied(
        db.queryAs(user, "insert into public.board_members (board_id, user_id, role) values ($1, $2, 'OWNER')", [
          fx.boardId,
          user.id,
        ]),
      );
      await expectDenied(db.queryAs(user, "update public.board_members set role = 'OWNER'"));
      await expectDenied(db.queryAs(user, "update public.canvas_objects set x = 999 where id = $1", [objectId]));
      await expectDenied(db.queryAs(user, "delete from public.canvas_objects"));
      await expectDenied(
        db.queryAs(
          user,
          "insert into public.board_activity (board_id, actor_id, type) values ($1, $2, 'BOARD_CREATED')",
          [fx.boardId, fx.owner.id],
        ),
      );
      await expectDenied(
        db.queryAs(user, "insert into public.board_comments (board_id, author_id, body) values ($1, $2, 'forged')", [
          fx.boardId,
          fx.owner.id,
        ]),
      );
      await expectDenied(db.queryAs(user, "update public.board_sharing set code_enabled = false"));
      await expectDenied(db.queryAs(user, "select * from public.security_events"));
    }
  });

  it("keeps anonymous visitors out of everything except the template catalog", async () => {
    await createBoardFixture(db);
    for (const table of ["boards", "board_members", "canvas_objects", "board_comments", "board_activity", "profiles"]) {
      await expectDenied(db.queryAs(null, `select * from public.${table}`));
    }
    const templates = await db.queryAs<{ slug: string }>(null, "select slug from public.templates order by sort_order");
    expect(templates.map((t) => t.slug)).toContain("project-roadmap");
    await expectDenied(
      db.queryAs(null, "insert into public.templates (slug, name, category) values ('x-y-z', 'x', 'STUDY')"),
    );
  });

  it("does not show unpublished templates", async () => {
    await db.admin(
      `insert into public.templates (slug, name, category, is_published) values ('hidden-draft', 'Draft', 'STUDY', false)`,
    );
    const user = await db.createUser();
    const rows = await db.queryAs(user, "select slug from public.templates where slug = 'hidden-draft'");
    expect(rows).toEqual([]);
    await expectCode(
      db.rpc(user, "create_board", { p_title: "x", p_template_slug: "hidden-draft" }),
      "TEMPLATE_NOT_FOUND",
    );
  });
});

describe("board management", () => {
  it("lets only the owner rename, and records the rename", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.editor, "update_board", { p_board_id: fx.boardId, p_title: "Mine now" }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      db.rpc(fx.viewer, "update_board", { p_board_id: fx.boardId, p_title: "Mine now" }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      db.rpc(fx.outsider, "update_board", { p_board_id: fx.boardId, p_title: "Mine now" }),
      "BOARD_NOT_FOUND",
    );

    const updated = await db.rpc<{ title: string }>(fx.owner, "update_board", {
      p_board_id: fx.boardId,
      p_title: "Renamed",
    });
    expect(updated.title).toBe("Renamed");
    const activity = await db.rpc<{ type: string }[]>(fx.owner, "get_board_activity", { p_board_id: fx.boardId });
    expect(activity[0].type).toBe("BOARD_RENAMED");
  });

  it("keeps the description when only renaming, and changes it only when one is sent", async () => {
    const owner = await db.createUser();
    const board = await db.rpc<{ id: string }>(owner, "create_board", {
      p_title: "Plan",
      p_description: "  Everything for the launch.  ",
    });
    type Row = { title: string; description: string };
    const update = (args: Record<string, unknown>) =>
      db.rpc<Row>(owner, "update_board", { p_board_id: board.id, ...args });

    // A rename sends no description, either by omitting it or by passing null.
    expect(await update({ p_title: "Launch plan" })).toMatchObject({
      title: "Launch plan",
      description: "Everything for the launch.",
    });
    expect(await update({ p_title: "Launch plan v2", p_description: null })).toMatchObject({
      title: "Launch plan v2",
      description: "Everything for the launch.",
    });

    // An explicit description replaces it (trimmed), and an explicit empty string clears it.
    expect(await update({ p_title: "Launch plan v2", p_description: "  Now with dates. " })).toMatchObject({
      title: "Launch plan v2",
      description: "Now with dates.",
    });
    expect(await update({ p_title: "Launch plan v2", p_description: "   " })).toMatchObject({ description: "" });
    await expectCode(update({ p_title: "Launch plan v2", p_description: "x".repeat(501) }), "VALIDATION_FAILED");
  });

  it("moves a deleted board to the owner's trash and hides it from members", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(db.rpc(fx.editor, "delete_board", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
    await db.rpc(fx.owner, "delete_board", { p_board_id: fx.boardId });

    expect(await db.rpc<BoardRow[]>(fx.editor, "list_boards")).toEqual([]);
    expect(await db.queryAs(fx.editor, "select id from public.boards")).toEqual([]);
    expect(await db.queryAs(fx.editor, "select id from public.canvas_objects")).toEqual([]);
    await expectCode(db.rpc(fx.editor, "load_board_state", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await expectCode(db.rpc(fx.owner, "load_board_state", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");

    const trash = await db.rpc<BoardRow[]>(fx.owner, "list_boards", { p_scope: "trash" });
    expect(trash.map((b) => b.id)).toEqual([fx.boardId]);
    expect(await db.rpc<BoardRow[]>(fx.editor, "list_boards", { p_scope: "trash" })).toEqual([]);

    await expectCode(db.rpc(fx.editor, "restore_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await db.rpc(fx.owner, "restore_board", { p_board_id: fx.boardId });
    expect((await db.rpc<BoardRow[]>(fx.editor, "list_boards")).map((b) => b.id)).toEqual([fx.boardId]);
  });

  it("purges only from trash, only for the owner", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(db.rpc(fx.owner, "purge_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await db.rpc(fx.owner, "delete_board", { p_board_id: fx.boardId });
    await expectCode(db.rpc(fx.editor, "purge_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await db.rpc(fx.owner, "purge_board", { p_board_id: fx.boardId });
    expect(await db.admin("select 1 from public.boards where id = $1", [fx.boardId])).toEqual([]);
    expect(await db.admin("select 1 from public.board_members where board_id = $1", [fx.boardId])).toEqual([]);
  });

  it("duplicates the canvas into a private board owned by the caller", async () => {
    const fx = await createBoardFixture(db, { template: "project-roadmap", title: "Original" });
    await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "Stays behind" });
    await expectCode(db.rpc(fx.viewer, "duplicate_board", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
    await expectCode(db.rpc(fx.outsider, "duplicate_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");

    const copy = await db.rpc<{ id: string; collaboration_code: string }>(fx.editor, "duplicate_board", {
      p_board_id: fx.boardId,
    });
    expect(copy.collaboration_code).not.toBe(fx.code);
    const state = await db.rpc<BoardState>(fx.editor, "load_board_state", { p_board_id: copy.id });
    expect(state.board).toMatchObject({ title: "Original (copy)", role: "OWNER", access_mode: "PRIVATE" });
    const original = await db.rpc<BoardState>(fx.owner, "load_board_state", { p_board_id: fx.boardId });
    expect(state.snapshot.objects).toHaveLength(original.snapshot.objects.length);
    expect(await db.rpc(fx.editor, "get_board_comments", { p_board_id: copy.id })).toEqual([]);
    expect(await db.rpc<unknown[]>(fx.editor, "get_board_members", { p_board_id: copy.id })).toHaveLength(1);
    await expectCode(db.rpc(fx.owner, "get_board", { p_board_id: copy.id }), "BOARD_NOT_FOUND");
  });
});

describe("membership", () => {
  it("returns members with limited profile fields and no email addresses", async () => {
    const fx = await createBoardFixture(db);
    const members = await db.rpc<Record<string, unknown>[]>(fx.viewer, "get_board_members", { p_board_id: fx.boardId });
    expect(members.map((m) => m.role)).toEqual(["OWNER", "EDITOR", "VIEWER"]);
    expect(JSON.stringify(members)).not.toContain("@");
    expect(Object.keys(members[0]).sort()).toEqual(
      ["avatar_url", "first_name", "joined_at", "last_name", "role", "user_id", "username"].sort(),
    );
  });

  it("lets only the owner change roles, and never to or from OWNER", async () => {
    const fx = await createBoardFixture(db);
    const change = (actor: typeof fx.owner, target: typeof fx.owner, role: string) =>
      db.rpc(actor, "change_member_role", { p_board_id: fx.boardId, p_user_id: target.id, p_role: role });

    await expectCode(change(fx.editor, fx.viewer, "EDITOR"), "BOARD_ACCESS_DENIED");
    await expectCode(change(fx.viewer, fx.viewer, "EDITOR"), "BOARD_ACCESS_DENIED");
    await expectCode(change(fx.owner, fx.viewer, "OWNER"), "INVALID_ROLE");
    await expectCode(change(fx.owner, fx.owner, "EDITOR"), "CANNOT_CHANGE_OWN_ROLE");
    await expectCode(change(fx.owner, fx.outsider, "EDITOR"), "MEMBER_NOT_FOUND");

    await change(fx.owner, fx.viewer, "EDITOR");
    const members = await db.rpc<{ user_id: string; role: string }[]>(fx.owner, "get_board_members", {
      p_board_id: fx.boardId,
    });
    expect(members.find((m) => m.user_id === fx.viewer.id)?.role).toBe("EDITOR");
    const activity = await db.rpc<{ type: string; subject_name: string }[]>(fx.owner, "get_board_activity", {
      p_board_id: fx.boardId,
    });
    expect(activity[0].type).toBe("MEMBER_ROLE_CHANGED");
    expect(activity[0].subject_name).toMatch(/^First\d+ Last\d+$/);
  });

  it("lets the owner remove members and members leave, but never removes the owner", async () => {
    const fx = await createBoardFixture(db);
    const remove = (actor: typeof fx.owner, target: typeof fx.owner) =>
      db.rpc(actor, "remove_member", { p_board_id: fx.boardId, p_user_id: target.id });

    await expectCode(remove(fx.editor, fx.viewer), "BOARD_ACCESS_DENIED");
    await expectCode(remove(fx.editor, fx.owner), "BOARD_ACCESS_DENIED");
    await expectCode(remove(fx.owner, fx.owner), "OWNER_CANNOT_LEAVE");

    await remove(fx.owner, fx.viewer);
    await expectCode(db.rpc(fx.viewer, "get_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    expect(await db.queryAs(fx.viewer, "select id from public.canvas_objects")).toEqual([]);

    await remove(fx.editor, fx.editor);
    await expectCode(db.rpc(fx.editor, "get_board", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    const types = (await db.rpc<{ type: string }[]>(fx.owner, "get_board_activity", { p_board_id: fx.boardId })).map(
      (a) => a.type,
    );
    expect(types.slice(0, 2)).toEqual(["MEMBER_LEFT", "MEMBER_REMOVED"]);
  });

  it("transfers ownership to an existing member", async () => {
    const fx = await createBoardFixture(db);
    await expectCode(
      db.rpc(fx.editor, "transfer_ownership", { p_board_id: fx.boardId, p_new_owner_id: fx.editor.id }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      db.rpc(fx.owner, "transfer_ownership", { p_board_id: fx.boardId, p_new_owner_id: fx.outsider.id }),
      "MEMBER_NOT_FOUND",
    );
    await db.rpc(fx.owner, "transfer_ownership", { p_board_id: fx.boardId, p_new_owner_id: fx.editor.id });

    const members = await db.rpc<{ user_id: string; role: string }[]>(fx.owner, "get_board_members", {
      p_board_id: fx.boardId,
    });
    expect(members.find((m) => m.user_id === fx.editor.id)?.role).toBe("OWNER");
    expect(members.find((m) => m.user_id === fx.owner.id)?.role).toBe("EDITOR");
    await expectCode(db.rpc(fx.owner, "delete_board", { p_board_id: fx.boardId }), "BOARD_ACCESS_DENIED");
    await db.rpc(fx.editor, "update_board", { p_board_id: fx.boardId, p_title: "New owner's board" });
  });

  it("allows only one owner per board at the database level", async () => {
    const fx = await createBoardFixture(db);
    await expect(
      db.admin("update public.board_members set role = 'OWNER' where board_id = $1 and user_id = $2", [
        fx.boardId,
        fx.editor.id,
      ]),
    ).rejects.toThrow(/unique/);
    await expect(
      db.admin("insert into public.board_members (board_id, user_id, role) values ($1, $2, 'VIEWER')", [
        fx.boardId,
        fx.editor.id,
      ]),
    ).rejects.toThrow(/unique/);
  });

  it("does not let an unverified member act", async () => {
    const fx = await createBoardFixture(db);
    const late = await db.createUser();
    await invite(db, fx.owner, fx.boardId, late, "EDITOR");
    await db.admin("update auth.users set email_confirmed_at = null where id = $1", [late.id]);
    await expectCode(createNote(db, late, fx.boardId), "EMAIL_NOT_VERIFIED");
    await expectCode(db.rpc(late, "add_comment", { p_board_id: fx.boardId, p_body: "hi" }), "EMAIL_NOT_VERIFIED");
  });
});
