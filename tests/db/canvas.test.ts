import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BoardState, CanvasObject, ServerOperation } from "@/lib/board/types";
import { createBoardFixture, createNote, expectCode, submit, type BoardFixture } from "./fixtures";
import { TestDatabase, uuid } from "./harness";

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

async function currentObject(objectId: string): Promise<CanvasObject & { deleted_at: string | null }> {
  const rows = await db.admin<CanvasObject & { deleted_at: string | null }>(
    "select * from public.canvas_objects where id = $1",
    [objectId],
  );
  return rows[0];
}

describe("permissions", () => {
  it("lets owners and editors edit the canvas", async () => {
    const byOwner = await createNote(db, fx.owner, fx.boardId);
    const byEditor = await createNote(db, fx.editor, fx.boardId);
    expect(byOwner.result.status).toBe("accepted");
    expect(byEditor.result.status).toBe("accepted");
    expect(byEditor.result.object).toMatchObject({ created_by: fx.editor.id, version: 1, deleted: false });
  });

  it("rejects every kind of edit from a viewer", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await expectCode(createNote(db, fx.viewer, fx.boardId), "BOARD_ACCESS_DENIED");
    await expectCode(
      submit(db, fx.viewer, fx.boardId, "OBJECT_MOVED", objectId, { x: 1, y: 1 }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(
      submit(db, fx.viewer, fx.boardId, "OBJECT_UPDATED", objectId, { props: { fill: "#000000" } }),
      "BOARD_ACCESS_DENIED",
    );
    await expectCode(submit(db, fx.viewer, fx.boardId, "OBJECT_DELETED", objectId), "BOARD_ACCESS_DENIED");
    const object = await currentObject(objectId);
    expect(object).toMatchObject({ x: 10, y: 20, version: 1, deleted_at: null });
  });

  it("rejects non-members without confirming the board exists", async () => {
    await expectCode(createNote(db, fx.outsider, fx.boardId), "BOARD_NOT_FOUND");
    await expectCode(
      db.rpc(fx.outsider, "get_operations_after", { p_board_id: fx.boardId, p_after: 0 }),
      "BOARD_NOT_FOUND",
    );
  });

  it("lets viewers read state and operations", async () => {
    await createNote(db, fx.owner, fx.boardId);
    const state = await db.rpc<BoardState>(fx.viewer, "load_board_state", { p_board_id: fx.boardId });
    expect(state.board.role).toBe("VIEWER");
    expect(state.operations).toHaveLength(1);
  });

  it("takes the actor from the session, not from the payload", async () => {
    const { result } = await createNote(db, fx.editor, fx.boardId, {
      created_by: fx.owner.id,
      actor_id: fx.owner.id,
      board_id: uuid(),
      version: 99,
    });
    expect(result.object).toMatchObject({ created_by: fx.editor.id, updated_by: fx.editor.id, version: 1 });
    const [operation] = await db.admin<{ actor_id: string }>(
      "select actor_id from public.board_operations where board_id = $1",
      [fx.boardId],
    );
    expect(operation.actor_id).toBe(fx.editor.id);
  });

  it("cannot touch an object that belongs to another board", async () => {
    const other = await createBoardFixture(db);
    const foreign = await createNote(db, other.owner, other.boardId);
    await expectCode(
      submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", foreign.objectId, { x: 500, y: 500 }),
      "VALIDATION_FAILED",
    );
    await expectCode(submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", foreign.objectId), "VALIDATION_FAILED");
    expect(await currentObject(foreign.objectId)).toMatchObject({ x: 10, y: 20, deleted_at: null });
  });
});

describe("validation", () => {
  it("rejects unknown operation and object types", async () => {
    await expectCode(submit(db, fx.owner, fx.boardId, "OBJECT_EXPLODED", uuid()), "VALIDATION_FAILED");
    await expectCode(createNote(db, fx.owner, fx.boardId, { type: "IFRAME" }), "VALIDATION_FAILED");
    await expectCode(createNote(db, fx.owner, fx.boardId, { x: "left" }), "VALIDATION_FAILED");
    await expectCode(createNote(db, fx.owner, fx.boardId, { x: 5_000_000 }), "VALIDATION_FAILED");
  });

  it("keeps image objects disabled until secure upload exists", async () => {
    await expectCode(createNote(db, fx.owner, fx.boardId, { type: "IMAGE" }), "IMAGE_UPLOAD_DISABLED");
  });

  it("drops unknown properties and unsafe values", async () => {
    const { result } = await createNote(db, fx.owner, fx.boardId, {
      props: {
        text: "<img src=x onerror=alert(1)>",
        fill: "url(javascript:alert(1))",
        stroke: "#12ab34",
        href: "https://evil.example",
        onclick: "steal()",
        fontSize: 9000,
        strokeWidth: 2,
      },
    });
    // Text is stored verbatim (it is rendered as text, never as HTML); everything else is whitelisted.
    expect(result.object.props).toEqual({ text: "<img src=x onerror=alert(1)>", stroke: "#12ab34", strokeWidth: 2 });
  });

  it("limits payload and text size", async () => {
    await expectCode(createNote(db, fx.owner, fx.boardId, { props: { text: "x".repeat(5001) } }), "VALIDATION_FAILED");
    await expectCode(createNote(db, fx.owner, fx.boardId, { junk: "x".repeat(70_000) }), "VALIDATION_FAILED");
    await expectCode(
      createNote(db, fx.owner, fx.boardId, { type: "DRAWING", props: { points: [1, 2, "three", 4] } }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      createNote(db, fx.owner, fx.boardId, { type: "DRAWING", props: { points: [1, 2, 3] } }),
      "VALIDATION_FAILED",
    );
  });

  it("rate-limits canvas operations", async () => {
    await db.admin(
      `insert into private.rate_limits (user_id, action, window_start, hits) values ($1, 'operation', now(), 600)`,
      [fx.editor.id],
    );
    await expectCode(createNote(db, fx.editor, fx.boardId), "RATE_LIMITED");
    expect((await createNote(db, fx.owner, fx.boardId)).result.status).toBe("accepted");
  });
});

describe("sequencing and deduplication", () => {
  it("assigns gap-free increasing sequence numbers", async () => {
    const sequences: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const author = i % 2 === 0 ? fx.owner : fx.editor;
      const { result } = await createNote(db, author, fx.boardId);
      if (result.status === "accepted") sequences.push(result.sequence);
    }
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
    const board = await db.rpc<{ last_sequence: number }>(fx.owner, "get_board", { p_board_id: fx.boardId });
    expect(board.last_sequence).toBe(5);
  });

  it("applies a retried operation exactly once", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const operationId = uuid();
    const first = await submit(
      db,
      fx.owner,
      fx.boardId,
      "OBJECT_MOVED",
      objectId,
      { x: 100, y: 100 },
      null,
      operationId,
    );
    const retry = await submit(
      db,
      fx.owner,
      fx.boardId,
      "OBJECT_MOVED",
      objectId,
      { x: 100, y: 100 },
      null,
      operationId,
    );
    expect(first).toMatchObject({ status: "accepted", sequence: 2 });
    expect(retry).toMatchObject({ status: "duplicate", sequence: 2 });
    expect(retry.object.version).toBe(2);

    const operations = await db.admin("select 1 from public.board_operations where board_id = $1", [fx.boardId]);
    expect(operations).toHaveLength(2);
    expect((await currentObject(objectId)).version).toBe(2);
  });

  it("scopes operation ids to the board", async () => {
    const other = await createBoardFixture(db);
    const operationId = uuid();
    const a = await submit(
      db,
      fx.owner,
      fx.boardId,
      "OBJECT_CREATED",
      uuid(),
      { type: "TEXT", x: 0, y: 0, width: 10, height: 10, props: {} },
      null,
      operationId,
    );
    const b = await submit(
      db,
      other.owner,
      other.boardId,
      "OBJECT_CREATED",
      uuid(),
      { type: "TEXT", x: 0, y: 0, width: 10, height: 10, props: {} },
      null,
      operationId,
    );
    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
  });

  it("enforces operation uniqueness in the schema", async () => {
    const { operationId, objectId } = await createNote(db, fx.owner, fx.boardId);
    await expect(
      db.admin(
        `insert into public.board_operations (board_id, operation_id, operation_type, object_id, object_state, resulting_version, board_sequence_number)
         values ($1, $2, 'OBJECT_MOVED', $3, '{}', 2, 99)`,
        [fx.boardId, operationId, objectId],
      ),
    ).rejects.toThrow(/unique/);
  });
});

describe("conflict handling", () => {
  it("increments the object version on every accepted change", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const moved = await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", objectId, { x: 340, y: 76 });
    const styled = await submit(db, fx.owner, fx.boardId, "OBJECT_UPDATED", objectId, { props: { fill: "#A8DDB2" } });
    expect(moved.object.version).toBe(2);
    expect(styled.object.version).toBe(3);
    expect(styled.object).toMatchObject({ x: 340, y: 76, updated_by: fx.owner.id });
    expect(styled.object.props).toMatchObject({ text: "A note", fill: "#A8DDB2" });
  });

  it("resolves concurrent moves as last accepted operation wins", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    // Both clients saw version 1.
    const first = await submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", objectId, { x: 100, y: 0 }, 1);
    const second = await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", objectId, { x: 200, y: 0 }, 1);
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    expect(await currentObject(objectId)).toMatchObject({ x: 200, version: 3 });
  });

  it("rejects a stale text edit and returns the current server state", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const first = await submit(
      db,
      fx.owner,
      fx.boardId,
      "OBJECT_UPDATED",
      objectId,
      { props: { text: "Owner's text" } },
      1,
    );
    expect(first.status).toBe("accepted");

    const stale = await submit(
      db,
      fx.editor,
      fx.boardId,
      "OBJECT_UPDATED",
      objectId,
      { props: { text: "Editor's text" } },
      1,
    );
    expect(stale).toMatchObject({ status: "conflict", code: "TEXT_CONFLICT" });
    expect(stale.object.props.text).toBe("Owner's text");
    expect(stale.object.version).toBe(2);
    // A rejected operation is not recorded and consumes no sequence number.
    const operations = await db.admin("select 1 from public.board_operations where board_id = $1", [fx.boardId]);
    expect(operations).toHaveLength(2);

    const retried = await submit(
      db,
      fx.editor,
      fx.boardId,
      "OBJECT_UPDATED",
      objectId,
      { props: { text: "Editor's text" } },
      2,
    );
    expect(retried.status).toBe("accepted");
    expect(retried.object.props.text).toBe("Editor's text");
  });

  it("lets deletion win over later updates", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const deleted = await submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", objectId);
    expect(deleted.object.deleted).toBe(true);

    const move = await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", objectId, { x: 999, y: 999 }, 1);
    const update = await submit(
      db,
      fx.editor,
      fx.boardId,
      "OBJECT_UPDATED",
      objectId,
      { props: { fill: "#000000" } },
      1,
    );
    const again = await submit(db, fx.editor, fx.boardId, "OBJECT_DELETED", objectId);
    for (const result of [move, update, again]) {
      expect(result).toMatchObject({ status: "conflict", code: "OBJECT_DELETED" });
      expect(result.object.deleted).toBe(true);
    }
    expect(await currentObject(objectId)).toMatchObject({ x: 10, y: 20 });
  });

  it("restores a deleted object as a new operation", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await expectCode(submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", uuid(), { x: 1, y: 1 }), "OBJECT_NOT_FOUND");
    expect(await submit(db, fx.owner, fx.boardId, "OBJECT_RESTORED", objectId)).toMatchObject({
      status: "conflict",
      code: "OBJECT_NOT_DELETED",
    });
    await submit(db, fx.owner, fx.boardId, "OBJECT_DELETED", objectId);
    const restored = await submit(db, fx.owner, fx.boardId, "OBJECT_RESTORED", objectId);
    expect(restored).toMatchObject({ status: "accepted", sequence: 3 });
    expect(restored.object).toMatchObject({ deleted: false, version: 3 });
    // History is appended to, never rewritten.
    const types = await db.admin<{ operation_type: string }>(
      "select operation_type from public.board_operations where board_id = $1 order by board_sequence_number",
      [fx.boardId],
    );
    expect(types.map((t) => t.operation_type)).toEqual(["OBJECT_CREATED", "OBJECT_DELETED", "OBJECT_RESTORED"]);
  });

  it("refuses to create an object id twice", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    const again = await submit(db, fx.editor, fx.boardId, "OBJECT_CREATED", objectId, {
      type: "TEXT",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      props: {},
    });
    expect(again).toMatchObject({ status: "conflict", code: "OBJECT_EXISTS" });
    expect(again.object.type).toBe("STICKY_NOTE");
  });
});

describe("snapshots and recovery", () => {
  function replay(state: BoardState): Map<string, CanvasObject> {
    const objects = new Map(state.snapshot.objects.map((object) => [object.id, object]));
    for (const operation of state.operations) {
      objects.set(operation.object.id, operation.object);
    }
    return objects;
  }

  it("rebuilds the board from the latest snapshot plus later operations", async () => {
    await db.admin("update private.settings set value = '5' where key = 'snapshot_interval'");
    try {
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        ids.push((await createNote(db, fx.owner, fx.boardId, { x: i * 10 })).objectId);
      }
      await submit(db, fx.editor, fx.boardId, "OBJECT_DELETED", ids[0]); // sequence 5 -> snapshot
      await submit(db, fx.editor, fx.boardId, "OBJECT_MOVED", ids[1], { x: 777, y: 1 }); // 6
      await submit(db, fx.editor, fx.boardId, "OBJECT_UPDATED", ids[2], { props: { text: "Edited" } }, 1); // 7

      const state = await db.rpc<BoardState>(fx.viewer, "load_board_state", { p_board_id: fx.boardId });
      expect(state.snapshot.sequence).toBe(5);
      expect(state.operations.map((operation) => operation.sequence)).toEqual([6, 7]);
      expect(state.last_sequence).toBe(7);
      // The snapshot excludes the deleted object.
      expect(state.snapshot.objects.map((object) => object.id).sort()).toEqual(ids.slice(1).sort());

      const rebuilt = replay(state);
      const truth = await db.admin<CanvasObject>(
        "select id, x, y, version, props from public.canvas_objects where board_id = $1 and deleted_at is null",
        [fx.boardId],
      );
      expect(truth).toHaveLength(3);
      for (const row of truth) {
        expect(rebuilt.get(row.id)).toMatchObject({ x: row.x, y: row.y, version: row.version, props: row.props });
      }
    } finally {
      await db.admin("update private.settings set value = '50' where key = 'snapshot_interval'");
    }
  });

  it("returns the operations a reconnecting client missed", async () => {
    const { objectId } = await createNote(db, fx.owner, fx.boardId);
    await submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", objectId, { x: 1, y: 1 });
    await submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", objectId, { x: 2, y: 2 });
    await submit(db, fx.owner, fx.boardId, "OBJECT_MOVED", objectId, { x: 3, y: 3 });

    const missed = await db.rpc<{ operations: ServerOperation[]; last_sequence: number }>(
      fx.editor,
      "get_operations_after",
      {
        p_board_id: fx.boardId,
        p_after: 2,
      },
    );
    expect(missed.last_sequence).toBe(4);
    expect(missed.operations.map((operation) => operation.sequence)).toEqual([3, 4]);
    expect(missed.operations[1].object).toMatchObject({ x: 3, y: 3, version: 4 });
    expect(missed.operations[1]).toMatchObject({ type: "OBJECT_MOVED", actor_id: fx.owner.id });

    const none = await db.rpc<{ operations: ServerOperation[] }>(fx.editor, "get_operations_after", {
      p_board_id: fx.boardId,
      p_after: 4,
    });
    expect(none.operations).toEqual([]);
  });

  it("persists the operation before announcing it, with matching content", async () => {
    const { objectId, operationId } = await createNote(db, fx.owner, fx.boardId);
    const messages = await db.admin<{ payload: ServerOperation; event: string; private: boolean }>(
      "select payload, event, private from realtime.messages where topic = $1",
      [`board:${fx.boardId}:operations`],
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ event: "operation", private: true });
    expect(messages[0].payload).toMatchObject({
      operation_id: operationId,
      sequence: 1,
      type: "OBJECT_CREATED",
      object_id: objectId,
      actor_id: fx.owner.id,
    });
    const stored = await db.admin(
      "select 1 from public.board_operations where board_id = $1 and operation_id = $2 and board_sequence_number = 1",
      [fx.boardId, operationId],
    );
    expect(stored).toHaveLength(1);
  });

  it("announces nothing for rejected or duplicate operations", async () => {
    const { objectId, operationId } = await createNote(db, fx.owner, fx.boardId);
    await submit(
      db,
      fx.owner,
      fx.boardId,
      "OBJECT_CREATED",
      objectId,
      { type: "TEXT", x: 0, y: 0, width: 1, height: 1 },
      null,
      operationId,
    );
    await submit(db, fx.owner, fx.boardId, "OBJECT_RESTORED", objectId);
    await expectCode(createNote(db, fx.viewer, fx.boardId), "BOARD_ACCESS_DENIED");
    const messages = await db.admin("select 1 from realtime.messages where topic = $1", [
      `board:${fx.boardId}:operations`,
    ]);
    expect(messages).toHaveLength(1);
  });

  it("touches the board so dashboards sort by recent work", async () => {
    await db.admin("update public.boards set updated_at = now() - interval '1 day' where id = $1", [fx.boardId]);
    await createNote(db, fx.owner, fx.boardId);
    const [row] = await db.admin<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from public.boards where id = $1",
      [fx.boardId],
    );
    expect(row.fresh).toBe(true);
  });
});
