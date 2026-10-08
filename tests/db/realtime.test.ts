import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBoardFixture, createNote, expectDenied, type BoardFixture } from "./fixtures";
import { TestDatabase, type TestUser } from "./harness";

/**
 * Supabase Realtime authorises a private channel by evaluating the RLS
 * policies on realtime.messages for the connection's JWT and the channel
 * topic: SELECT decides whether the client may listen, INSERT whether it may
 * send. These tests evaluate the same policies the same way. They prove the
 * authorization rules; they do not exercise the Realtime server itself.
 */
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
  await db.admin("delete from realtime.messages");
  fx = await createBoardFixture(db);
});

const CHANNELS = ["operations", "presence", "cursors", "comments", "activity"] as const;
const topic = (boardId: string, channel: string) => `board:${boardId}:${channel}`;

/** Can this user listen on the topic? (Is a message on it visible under the SELECT policy.) */
async function canListen(
  user: TestUser | null,
  boardTopic: string,
  extension: "broadcast" | "presence",
): Promise<boolean> {
  await db.admin("insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}')", [
    boardTopic,
    extension,
  ]);
  try {
    const rows = await db.withTopic<{ n: number }>(
      user,
      boardTopic,
      "select count(*)::int as n from realtime.messages where topic = $1 and extension = $2",
      [boardTopic, extension],
    );
    return rows[0].n > 0;
  } catch {
    return false;
  }
}

/** Can this user send on the topic? (Does an insert pass the INSERT policy.) */
async function canSend(
  user: TestUser | null,
  boardTopic: string,
  extension: "broadcast" | "presence",
): Promise<boolean> {
  try {
    await db.withTopic(
      user,
      boardTopic,
      "insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}')",
      [boardTopic, extension],
    );
    return true;
  } catch {
    return false;
  }
}

describe("channel subscription", () => {
  it("allows every member to listen on all five board channels", async () => {
    for (const member of [fx.owner, fx.editor, fx.viewer]) {
      for (const channel of CHANNELS) {
        const extension = channel === "presence" ? "presence" : "broadcast";
        expect(await canListen(member, topic(fx.boardId, channel), extension), `${channel}`).toBe(true);
      }
    }
  });

  it("rejects non-members and anonymous connections", async () => {
    for (const channel of CHANNELS) {
      const extension = channel === "presence" ? "presence" : "broadcast";
      expect(await canListen(fx.outsider, topic(fx.boardId, channel), extension)).toBe(false);
      expect(await canListen(null, topic(fx.boardId, channel), extension)).toBe(false);
    }
  });

  it("does not let membership of one board open another board's channels", async () => {
    const other = await createBoardFixture(db);
    expect(await canListen(fx.owner, topic(other.boardId, "operations"), "broadcast")).toBe(false);
    expect(await canSend(fx.owner, topic(other.boardId, "cursors"), "broadcast")).toBe(false);
    expect(await canSend(fx.owner, topic(other.boardId, "presence"), "presence")).toBe(false);
  });

  it("rejects malformed or unknown topics without erroring", async () => {
    for (const bad of [
      "board:not-a-uuid:operations",
      `board:${fx.boardId}`,
      `board:${fx.boardId}:secrets`,
      `room:${fx.boardId}:operations`,
      `board:${fx.boardId}:operations:extra`,
      "",
    ]) {
      expect(await canListen(fx.owner, bad || "x", "broadcast"), bad).toBe(false);
      expect(await canSend(fx.owner, bad || "x", "broadcast"), bad).toBe(false);
    }
  });

  it("stops authorising a member once they are removed or the board is deleted", async () => {
    await db.rpc(fx.owner, "remove_member", { p_board_id: fx.boardId, p_user_id: fx.editor.id });
    expect(await canListen(fx.editor, topic(fx.boardId, "operations"), "broadcast")).toBe(false);
    expect(await canSend(fx.editor, topic(fx.boardId, "cursors"), "broadcast")).toBe(false);

    await db.rpc(fx.owner, "delete_board", { p_board_id: fx.boardId });
    expect(await canListen(fx.viewer, topic(fx.boardId, "operations"), "broadcast")).toBe(false);
    expect(await canListen(fx.owner, topic(fx.boardId, "operations"), "broadcast")).toBe(false);
  });
});

describe("sending", () => {
  it("lets members track presence and send cursors, including viewers", async () => {
    for (const member of [fx.owner, fx.editor, fx.viewer]) {
      expect(await canSend(member, topic(fx.boardId, "presence"), "presence")).toBe(true);
      expect(await canSend(member, topic(fx.boardId, "cursors"), "broadcast")).toBe(true);
    }
  });

  it("never lets a client broadcast operations, comments or activity", async () => {
    for (const member of [fx.owner, fx.editor, fx.viewer]) {
      for (const channel of ["operations", "comments", "activity"]) {
        expect(await canSend(member, topic(fx.boardId, channel), "broadcast"), `${channel}`).toBe(false);
        expect(await canSend(member, topic(fx.boardId, channel), "presence"), `${channel}`).toBe(false);
      }
      // Channels are single-purpose: no broadcasts on :presence, no presence on :cursors.
      expect(await canSend(member, topic(fx.boardId, "presence"), "broadcast")).toBe(false);
      expect(await canSend(member, topic(fx.boardId, "cursors"), "presence")).toBe(false);
    }
  });

  it("rejects non-members and anonymous senders", async () => {
    expect(await canSend(fx.outsider, topic(fx.boardId, "cursors"), "broadcast")).toBe(false);
    expect(await canSend(fx.outsider, topic(fx.boardId, "presence"), "presence")).toBe(false);
    expect(await canSend(null, topic(fx.boardId, "cursors"), "broadcast")).toBe(false);
  });

  it("does not allow clients to rewrite or remove messages", async () => {
    await createNote(db, fx.owner, fx.boardId);
    await expectDenied(
      db.withTopic(fx.owner, topic(fx.boardId, "operations"), "update realtime.messages set payload = '{}'"),
    );
    await expectDenied(db.withTopic(fx.owner, topic(fx.boardId, "operations"), "delete from realtime.messages"));
  });
});

describe("server broadcasts", () => {
  it("deliver an accepted operation only to that board's members", async () => {
    const other = await createBoardFixture(db);
    await createNote(db, fx.editor, fx.boardId);

    const seen = async (user: TestUser, boardId: string) =>
      (
        await db.withTopic<{ n: number }>(
          user,
          topic(boardId, "operations"),
          "select count(*)::int as n from realtime.messages where topic = $1",
          [topic(fx.boardId, "operations")],
        )
      )[0].n;

    expect(await seen(fx.viewer, fx.boardId)).toBe(1);
    expect(await seen(fx.outsider, fx.boardId)).toBe(0);
    // A member of another board, listening on their own topic, sees none of this board's messages...
    expect(
      (
        await db.withTopic<{ n: number }>(
          other.owner,
          topic(other.boardId, "operations"),
          "select count(*)::int as n from realtime.messages where topic = $1",
          [topic(other.boardId, "operations")],
        )
      )[0].n,
    ).toBe(0);
    // ...and cannot subscribe to this board's topic at all.
    expect(await seen(other.owner, fx.boardId)).toBe(0);
  });

  it("are sent as private messages", async () => {
    await createNote(db, fx.owner, fx.boardId);
    await db.rpc(fx.owner, "add_comment", { p_board_id: fx.boardId, p_body: "hi" });
    const rows = await db.admin<{ private: boolean }>("select private from realtime.messages where topic like $1", [
      `board:${fx.boardId}:%`,
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((row) => row.private === true)).toBe(true);
  });

  it("do not undo the user's change if Realtime is unavailable", async () => {
    await db.admin("alter function realtime.send(jsonb, text, text, boolean) rename to send_disabled");
    try {
      const { result } = await createNote(db, fx.owner, fx.boardId);
      expect(result.status).toBe("accepted");
      const stored = await db.admin("select 1 from public.board_operations where board_id = $1", [fx.boardId]);
      expect(stored).toHaveLength(1);
    } finally {
      await db.admin("alter function realtime.send_disabled(jsonb, text, text, boolean) rename to send");
    }
  });
});
