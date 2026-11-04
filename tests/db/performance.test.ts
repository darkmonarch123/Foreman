import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectCode, type BoardFixture } from "./fixtures";
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

describe("load_board_page", () => {
  it("returns exactly what load_board_state and get_board_members return, in one call", async () => {
    await createNote(db, fx.owner, fx.boardId, { props: { text: "Hello" } });
    const page = await db.rpc<{ state: unknown; members: unknown }>(fx.editor, "load_board_page", {
      p_board_id: fx.boardId,
    });
    expect(page.state).toEqual(await db.rpc(fx.editor, "load_board_state", { p_board_id: fx.boardId }));
    expect(page.members).toEqual(await db.rpc(fx.editor, "get_board_members", { p_board_id: fx.boardId }));
  });

  it("keeps the same permission checks: outsiders and anonymous callers get nothing", async () => {
    await expectCode(db.rpc(fx.outsider, "load_board_page", { p_board_id: fx.boardId }), "BOARD_NOT_FOUND");
    await expect(db.rpc(null, "load_board_page", { p_board_id: fx.boardId })).rejects.toThrow();
  });
});

describe("assistant_board_snapshot", () => {
  const snapshot = (user = fx.owner, action = "find_planning_gaps") =>
    db.rpc<{
      role: string;
      objects: { id: string; props: Record<string, unknown> }[];
      comments: Record<string, unknown>[];
    }>(user, "assistant_board_snapshot", { p_board_id: fx.boardId, p_action: action });

  it("returns live objects with only their text, and comment anchors without comment text", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId, {
      props: { text: "Who owns pricing?", fill: "#F8DD72" },
    });
    await createNote(db, fx.owner, fx.boardId, {
      type: "DRAWING",
      props: { points: [0, 0, 10, 10, 20, 5], stroke: "#121212", strokeWidth: 3 },
    });
    await db.rpc(fx.owner, "add_comment", {
      p_board_id: fx.boardId,
      p_body: "Secret comment body",
      p_object_id: objectId,
    });

    const result = await snapshot();
    expect(result.role).toBe("OWNER");
    const note = result.objects.find((object) => object.id === objectId)!;
    expect(note.props).toEqual({ text: "Who owns pricing?" });
    const drawing = result.objects.find((object) => object.id !== objectId)!;
    expect(drawing.props).toEqual({});
    expect(Object.keys(note).sort()).toEqual(
      ["height", "id", "props", "rotation", "type", "updated_at", "version", "width", "x", "y", "z_index"].sort(),
    );
    expect(result.comments).toEqual([{ id: expect.any(String), object_id: objectId }]);
    expect(JSON.stringify(result)).not.toContain("Secret comment body");
  });

  it("leaves out deleted objects", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await db.rpc(fx.owner, "submit_operation", {
      p_board_id: fx.boardId,
      p_operation_id: crypto.randomUUID(),
      p_type: "OBJECT_DELETED",
      p_object_id: objectId,
      p_payload: {},
      p_expected_version: 1,
    });
    expect((await snapshot()).objects).toEqual([]);
  });

  it("runs the same checks as before, before reading anything", async () => {
    await expectCode(snapshot(fx.outsider), "BOARD_NOT_FOUND");
    await expectCode(snapshot(fx.viewer, "propose_plan"), "BOARD_ACCESS_DENIED");
    await expectCode(snapshot(fx.owner, "delete_board"), "VALIDATION_FAILED");
    expect((await snapshot(fx.viewer, "find_planning_gaps")).role).toBe("VIEWER");
    await db.admin(
      "insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'assistant_run', now(), 30)",
      [fx.editor.id],
    );
    await expectCode(snapshot(fx.editor), "RATE_LIMITED");
  });

  it("counts nothing towards the run limit (assistant_create_run does)", async () => {
    for (let i = 0; i < 15; i += 1) await snapshot(fx.editor);
    const rows = await db.admin("select * from private.rate_limits where user_id = $1 and action like 'assistant%'", [
      fx.editor.id,
    ]);
    expect(rows).toEqual([]);
  });
});

describe("indexes from the query audit", () => {
  it("exist", async () => {
    const rows = await db.admin<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and indexname = any($1) order by 1",
      [
        [
          "assistant_proposals_creator_status_idx",
          "board_activity_actor_idx",
          "board_comments_author_idx",
          "board_comments_board_live_idx",
          "board_operations_actor_idx",
        ],
      ],
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      "assistant_proposals_creator_status_idx",
      "board_activity_actor_idx",
      "board_comments_author_idx",
      "board_comments_board_live_idx",
      "board_operations_actor_idx",
    ]);
  });
});
