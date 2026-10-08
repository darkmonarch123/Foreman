import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectCode, submit, type BoardFixture } from "./fixtures";
import { TestDatabase } from "./harness";

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

interface Comment {
  id: string;
  author_id: string;
  object_id: string | null;
  body: string;
  edited_at: string | null;
  author: { first_name: string; last_name: string; avatar_url: string };
}

interface Activity {
  id: string;
  type: string;
  actor_id: string;
  object_id: string | null;
  metadata: Record<string, unknown>;
  actor: { first_name: string };
}

const comments = (user: BoardFixture["owner"]) =>
  db.rpc<Comment[]>(user, "get_board_comments", { p_board_id: fx.boardId });
const activity = (user: BoardFixture["owner"]) =>
  db.rpc<Activity[]>(user, "get_board_activity", { p_board_id: fx.boardId });

describe("comments", () => {
  it("persist with the real author and are visible to every member", async () => {
    const created = await db.rpc<Comment>(fx.editor, "add_comment", {
      p_board_id: fx.boardId,
      p_body: "  Looks good  ",
    });
    expect(created).toMatchObject({ author_id: fx.editor.id, body: "Looks good", object_id: null });
    expect(created.author.avatar_url).toMatch(/^\/api\/avatar\//);

    for (const reader of [fx.owner, fx.editor, fx.viewer]) {
      expect((await comments(reader)).map((c) => c.id)).toEqual([created.id]);
    }
    await expectCode(comments(fx.outsider), "BOARD_NOT_FOUND");
    expect(JSON.stringify(await comments(fx.viewer))).not.toContain("@");
  });

  it("reject empty or oversized bodies", async () => {
    await expectCode(
      db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "   \n " }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "x".repeat(2001) }),
      "VALIDATION_FAILED",
    );
    await expectCode(db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: null }), "VALIDATION_FAILED");
  });

  it("can be anchored to an object on the same board only", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const anchored = await db.rpc<Comment>(fx.editor, "add_comment", {
      p_board_id: fx.boardId,
      p_body: "About this note",
      p_object_id: objectId,
    });
    expect(anchored.object_id).toBe(objectId);

    const other = await createBoardFixture(db);
    const foreign = await createNote(db, other.owner, other.boardId);
    await expectCode(
      db.rpc(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "x", p_object_id: foreign.objectId }),
      "OBJECT_NOT_FOUND",
    );
  });

  it("are disabled for viewers unless the owner allows it", async () => {
    await expectCode(db.rpc(fx.viewer, "add_comment", { p_board_id: fx.boardId, p_body: "hi" }), "COMMENTING_DISABLED");
    await db.rpc(fx.owner, "update_sharing", { p_board_id: fx.boardId, p_viewers_can_comment: true });
    const created = await db.rpc<Comment>(fx.viewer, "add_comment", { p_board_id: fx.boardId, p_body: "hi" });
    expect(created.author_id).toBe(fx.viewer.id);
    // Being allowed to comment does not make a viewer an editor.
    await expectCode(createNote(db, fx.viewer, fx.boardId), "BOARD_ACCESS_DENIED");
  });

  it("can be edited and deleted only by their author", async () => {
    const created = await db.rpc<Comment>(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "First draft" });
    await expectCode(
      db.rpc(fx.owner, "update_comment", { p_comment_id: created.id, p_body: "Owner edit" }),
      "COMMENT_NOT_FOUND",
    );
    await expectCode(db.rpc(fx.owner, "delete_comment", { p_comment_id: created.id }), "COMMENT_NOT_FOUND");
    await expectCode(db.rpc(fx.outsider, "delete_comment", { p_comment_id: created.id }), "COMMENT_NOT_FOUND");

    const edited = await db.rpc<Comment>(fx.editor, "update_comment", {
      p_comment_id: created.id,
      p_body: "Second draft",
    });
    expect(edited.body).toBe("Second draft");
    expect(edited.edited_at).not.toBeNull();

    await db.rpc(fx.editor, "delete_comment", { p_comment_id: created.id });
    expect(await comments(fx.owner)).toEqual([]);
    expect(await db.queryAs(fx.owner, "select id from public.board_comments")).toEqual([]);
    const [row] = await db.admin<{ body: string }>("select body from public.board_comments where id = $1", [
      created.id,
    ]);
    expect(row.body).toBe("[deleted]");
    await expectCode(
      db.rpc(fx.editor, "update_comment", { p_comment_id: created.id, p_body: "Back" }),
      "COMMENT_NOT_FOUND",
    );
  });

  it("cannot be edited by someone who has left the board", async () => {
    const created = await db.rpc<Comment>(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "Mine" });
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.editor.id });
    await expectCode(
      db.rpc(fx.editor, "update_comment", { p_comment_id: created.id, p_body: "Still mine" }),
      "BOARD_NOT_FOUND",
    );
  });

  it("are paginated newest first", async () => {
    for (let i = 1; i <= 5; i += 1) {
      await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: `Comment ${i}` });
    }
    const page = await db.rpc<(Comment & { created_at: string })[]>(fx.owner, "get_board_comments", {
      p_board_id: fx.boardId,
      p_limit: 2,
    });
    expect(page.map((c) => c.body)).toEqual(["Comment 5", "Comment 4"]);
    const next = await db.rpc<Comment[]>(fx.owner, "get_board_comments", {
      p_board_id: fx.boardId,
      p_limit: 2,
      p_before: page[1].created_at,
    });
    expect(next.map((c) => c.body)).toEqual(["Comment 3", "Comment 2"]);
  });

  it("are announced on the board's comments channel after being stored", async () => {
    const created = await db.rpc<Comment>(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "Hello" });
    await db.rpc(fx.editor, "update_comment", { p_comment_id: created.id, p_body: "Hello again" });
    await db.rpc(fx.editor, "delete_comment", { p_comment_id: created.id });
    const messages = await db.admin<{ payload: { action: string; comment: { id: string } } }>(
      "select payload from realtime.messages where topic = $1 order by inserted_at",
      [`board:${fx.boardId}:comments`],
    );
    expect(messages.map((m) => m.payload.action)).toEqual(["created", "updated", "deleted"]);
    expect(messages.every((m) => m.payload.comment.id === created.id)).toBe(true);
  });

  it("are rate-limited", async () => {
    await db.admin(
      `insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'comment', now(), 60)`,
      [fx.editor.id],
    );
    await expectCode(db.rpc(fx.editor, "add_comment", { p_board_id: fx.boardId, p_body: "spam" }), "RATE_LIMITED");
  });
});

describe("activity", () => {
  it("records server-generated events with the authenticated actor", async () => {
    const { objectId } = await createNote(db, fx.editor, fx.boardId);
    await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "Nice", p_object_id: objectId });
    await db.rpc(fx.viewer, "record_board_export", { p_board_id: fx.boardId });

    const feed = await activity(fx.viewer);
    expect(feed.slice(0, 3).map((a) => [a.type, a.actor_id])).toEqual([
      ["BOARD_EXPORTED", fx.viewer.id],
      ["COMMENT_CREATED", fx.owner.id],
      ["OBJECT_CREATED", fx.editor.id],
    ]);
    expect(feed[0].metadata).toEqual({ format: "png", scope: "board" });
    expect(feed[2]).toMatchObject({ object_id: objectId, metadata: { object_type: "STICKY_NOTE" } });
    expect(feed[2].actor.first_name).toMatch(/^First/);
    await expectCode(activity(fx.outsider), "BOARD_NOT_FOUND");
    await expectCode(db.rpc(fx.outsider, "record_board_export", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
  });

  it("is newest first and paginated", async () => {
    const feed = await db.rpc<(Activity & { created_at: string })[]>(fx.owner, "get_board_activity", {
      p_board_id: fx.boardId,
      p_limit: 2,
    });
    expect(feed).toHaveLength(2);
    expect(Date.parse(feed[0].created_at)).toBeGreaterThanOrEqual(Date.parse(feed[1].created_at));
    const older = await db.rpc<Activity[]>(fx.owner, "get_board_activity", {
      p_board_id: fx.boardId,
      p_limit: 50,
      p_before: feed[1].created_at,
    });
    expect(older.length).toBeGreaterThan(0);
    expect(older.map((a) => a.id)).not.toContain(feed[0].id);
    expect(older.at(-1)?.type).toBe("BOARD_CREATED");
  });

  it("folds a burst of moves of one object into a single entry", async () => {
    const { objectId } = await createNote(db, fx.editor, fx.boardId);
    for (let i = 0; i < 4; i += 1) {
      await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", objectId, { x: i, y: i });
    }
    await submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", objectId, { x: 50, y: 50 });
    const moves = (await activity(fx.owner)).filter((a) => a.type === "OBJECT_MOVED");
    expect(moves.map((a) => [a.actor_id, a.metadata.repeat ?? 1])).toEqual([
      [fx.owner.id, 1],
      [fx.editor.id, 4],
    ]);
  });

  it("never stores secrets or board text in metadata", async () => {
    await createNote(db, fx.owner, fx.boardId, { props: { text: "Confidential launch date" } });
    await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "Private remark" });
    await db.rpc(fx.owner, "regenerate_share_link", { p_board_id: fx.boardId });
    await db.rpc(fx.owner, "regenerate_collaboration_code", { p_board_id: fx.boardId });
    const sharing = await db.admin<{ collaboration_code: string; share_token_hash: string }>(
      "select collaboration_code, share_token_hash from public.board_sharing where board_id = $1",
      [fx.boardId],
    );
    const dump = JSON.stringify(
      await db.admin("select * from public.board_activity where board_id = $1", [fx.boardId]),
    );
    expect(dump).not.toContain("Confidential");
    expect(dump).not.toContain("Private remark");
    expect(dump).not.toContain(sharing[0].collaboration_code);
    expect(dump).not.toContain(sharing[0].share_token_hash);
    expect(dump).not.toContain("@example.test");
  });

  it("is announced on the activity channel", async () => {
    await createNote(db, fx.owner, fx.boardId);
    const messages = await db.admin<{ payload: { type: string; actor_id: string }; event: string }>(
      "select payload, event from realtime.messages where topic = $1 order by inserted_at desc limit 1",
      [`board:${fx.boardId}:activity`],
    );
    expect(messages[0]).toMatchObject({
      event: "activity",
      payload: { type: "OBJECT_CREATED", actor_id: fx.owner.id },
    });
  });

  it("keeps security events out of board activity", async () => {
    await db.rpc(fx.owner, "change_member_role", { p_board_id: fx.boardId, p_user_id: fx.viewer.id, p_role: "EDITOR" });
    const events = await db.admin<{ event_type: string }>(
      "select event_type from public.security_events where user_id = $1",
      [fx.owner.id],
    );
    expect(events.map((e) => e.event_type)).toContain("MEMBER_ROLE_CHANGED");
    for (const user of [fx.owner, fx.editor]) {
      await expect(db.queryAs(user, "select * from public.security_events")).rejects.toThrow(/permission denied/);
    }
  });
});
