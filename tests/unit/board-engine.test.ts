import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardEngine, type EngineNotice } from "@/lib/board/engine";
import { createMemoryPendingStore, type PendingStore } from "@/lib/board/storage";
import type { CreatePayload } from "@/lib/board/types";
import { FakeBoardServer } from "../support/fake-board-server";

const NOTE: CreatePayload = { type: "STICKY_NOTE", x: 0, y: 0, width: 160, height: 120, props: { text: "note" } };

interface Client {
  engine: BoardEngine;
  store: PendingStore;
  notices: EngineNotice[];
  unsubscribe: () => void;
}

function connect(
  server: FakeBoardServer,
  userId: string,
  options: { canEdit?: boolean; store?: PendingStore; realtime?: boolean } = {},
): Client {
  const store = options.store ?? createMemoryPendingStore();
  const notices: EngineNotice[] = [];
  const engine = new BoardEngine({
    userId,
    initial: server.state(),
    transport: server.transportFor(userId),
    store,
    canEdit: options.canEdit ?? true,
    onNotice: (notice) => notices.push(notice),
    random: () => 0.5,
  });
  const unsubscribe =
    options.realtime === false ? () => {} : server.subscribe((operation) => engine.receive(operation));
  engine.start();
  return { engine, store, notices, unsubscribe };
}

/** Lets queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("optimistic editing", () => {
  it("shows a local edit immediately and keeps it queued until acknowledged", async () => {
    const server = new FakeBoardServer();
    const { engine, store } = connect(server, "ada");

    const id = engine.create(NOTE)!;
    // Visible before any network round trip.
    expect(engine.getSnapshot().objects.map((o) => o.id)).toEqual([id]);
    expect(engine.getSnapshot()).toMatchObject({ status: "saving", pendingCount: 1 });
    expect(store.load()).toHaveLength(1);
    expect(server.lastSequence).toBe(0);

    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", pendingCount: 0, lastSequence: 1 });
    expect(store.load()).toEqual([]);
    expect(server.objects.get(id)).toMatchObject({ version: 1, created_by: "ada" });
  });

  it("sends queued operations one at a time, in order", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const id = engine.create(NOTE)!;
    engine.move(id, { x: 340, y: 76 });
    engine.update(id, { props: { text: "In Build" } });
    expect(engine.getSnapshot().byId.get(id)).toMatchObject({ x: 340, version: 3 });

    await settle();
    expect(server.log.map((o) => o.type)).toEqual(["OBJECT_CREATED", "OBJECT_MOVED", "OBJECT_UPDATED"]);
    expect(server.objects.get(id)).toMatchObject({ x: 340, y: 76, version: 3, props: { text: "In Build" } });
    expect(engine.getSnapshot().byId.get(id)).toEqual(server.objects.get(id));
  });

  it("ignores edits from a viewer", async () => {
    const server = new FakeBoardServer();
    const owner = connect(server, "ada");
    const id = owner.engine.create(NOTE)!;
    await settle();

    const viewer = connect(server, "vic", { canEdit: false });
    expect(viewer.engine.create(NOTE)).toBeNull();
    expect(viewer.engine.move(id, { x: 5, y: 5 })).toBe(false);
    expect(viewer.engine.remove(id)).toBe(false);
    await settle();
    expect(server.lastSequence).toBe(1);
    expect(viewer.engine.getSnapshot().canUndo).toBe(false);
  });
});

describe("collaboration", () => {
  it("delivers one user's accepted operation to another", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");

    const id = ada.engine.create(NOTE)!;
    await settle();
    expect(ben.engine.getSnapshot().objects.map((o) => o.id)).toEqual([id]);

    ben.engine.update(id, { props: { fill: "#A8DDB2" } });
    await settle();
    expect(ada.engine.getSnapshot().byId.get(id)?.props.fill).toBe("#A8DDB2");
    expect(ada.engine.getSnapshot().lastSequence).toBe(2);
    expect(ben.engine.getSnapshot().lastSequence).toBe(2);
  });

  it("does not double-apply an operation that arrives as both broadcast and acknowledgement", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const id = ada.engine.create(NOTE)!;
    ada.engine.move(id, { x: 10, y: 10 });
    await settle();
    expect(ada.engine.getSnapshot().byId.get(id)).toMatchObject({ x: 10, version: 2 });
    expect(ada.engine.getSnapshot().lastSequence).toBe(2);
  });

  it("recovers operations it missed when it sees a sequence gap", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben", { realtime: false });

    const first = ada.engine.create(NOTE)!;
    const second = ada.engine.create({ ...NOTE, x: 300 })!;
    await settle();
    expect(ben.engine.getSnapshot().objects).toEqual([]);

    // Ben only receives the third operation: the engine must notice 1 and 2 are missing.
    ada.engine.move(first, { x: 50, y: 50 });
    await settle();
    ben.engine.receive(server.log[2]);
    await settle();

    expect(ben.engine.getSnapshot().lastSequence).toBe(3);
    expect(
      ben.engine
        .getSnapshot()
        .objects.map((o) => o.id)
        .sort(),
    ).toEqual([first, second].sort());
    expect(ben.engine.getSnapshot().byId.get(first)).toMatchObject({ x: 50, version: 2 });
  });

  it("catches up when its own acknowledgement is ahead of what it has received", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben", { realtime: false });
    const adaNote = ada.engine.create(NOTE)!;
    await settle();

    // Ben has not heard about sequence 1; his own create is acknowledged as sequence 2.
    const benNote = ben.engine.create({ ...NOTE, x: 500 })!;
    await settle();
    expect(ben.engine.getSnapshot().lastSequence).toBe(2);
    expect(
      ben.engine
        .getSnapshot()
        .objects.map((o) => o.id)
        .sort(),
    ).toEqual([adaNote, benNote].sort());
  });

  it("keeps a pending local move on top of a remote change to the same object", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    await settle();

    ben.engine.setOnline(false);
    ben.engine.move(id, { x: 900, y: 0 });
    ada.engine.update(id, { props: { fill: "#F3A5A0" } });
    await settle();

    // Ben sees Ada's colour and still sees his own unsent position.
    const view = ben.engine.getSnapshot().byId.get(id)!;
    expect(view.x).toBe(900);
    expect(view.props.fill).toBe("#F3A5A0");
    expect(ben.engine.getSnapshot().status).toBe("offline");
  });
});

describe("offline, reconnect and recovery", () => {
  it("queues while offline and sends everything on reconnect", async () => {
    const server = new FakeBoardServer();
    const { engine, store } = connect(server, "ada");
    engine.setOnline(false);
    const id = engine.create(NOTE)!;
    engine.move(id, { x: 20, y: 20 });
    await settle();

    expect(engine.getSnapshot()).toMatchObject({ status: "offline", pendingCount: 2 });
    expect(store.load()).toHaveLength(2);
    expect(server.lastSequence).toBe(0);

    engine.setOnline(true);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", pendingCount: 0, lastSequence: 2 });
    expect(server.objects.get(id)).toMatchObject({ x: 20, version: 2 });
  });

  it("fetches what it missed while offline before resending its own work", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    await settle();

    ben.unsubscribe();
    ben.engine.setOnline(false);
    ada.engine.move(id, { x: 111, y: 0 });
    ada.engine.update(id, { props: { fill: "#AEB9F4" } });
    await settle();
    const benNote = ben.engine.create({ ...NOTE, x: 700 })!;
    expect(ben.engine.getSnapshot().byId.get(id)?.x).toBe(0);

    ben.engine.setOnline(true);
    await settle();
    expect(ben.engine.getSnapshot().byId.get(id)).toMatchObject({ x: 111, version: 3 });
    expect(ben.engine.getSnapshot().lastSequence).toBe(4);
    expect(server.objects.has(benNote)).toBe(true);
  });

  it("retries with backoff after a network failure and never loses the operation", async () => {
    const server = new FakeBoardServer();
    const { engine, store } = connect(server, "ada");
    server.failNext("NETWORK", 2);
    const id = engine.create(NOTE)!;
    await settle();

    expect(engine.getSnapshot()).toMatchObject({ status: "reconnecting", pendingCount: 1 });
    expect(store.load()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", pendingCount: 0 });
    expect(server.objects.has(id)).toBe(true);
    expect(server.submitCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("re-sends a stored operation after a reload without applying it twice", async () => {
    const server = new FakeBoardServer();
    const first = connect(server, "ada");
    const id = first.engine.create(NOTE)!;
    await settle();

    // The move reaches the server, but the tab closes before the acknowledgement is processed.
    first.engine.setOnline(false);
    first.engine.move(id, { x: 250, y: 0 });
    const leftover = first.store.load();
    expect(leftover).toHaveLength(1);
    server.apply("ada", leftover[0]);
    expect(server.lastSequence).toBe(2);
    first.engine.dispose();

    const second = connect(server, "ada", { store: createMemoryPendingStore(leftover) });
    expect(second.engine.getSnapshot().pendingCount).toBe(1);
    await settle();

    expect(second.engine.getSnapshot()).toMatchObject({ status: "saved", pendingCount: 0, lastSequence: 2 });
    expect(server.lastSequence).toBe(2);
    expect(server.objects.get(id)).toMatchObject({ x: 250, version: 2 });
    expect(second.store.load()).toEqual([]);
  });

  it("reports reconnecting while the realtime channel is down and resyncs when it returns", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben", { realtime: false });
    ben.engine.setRealtimeConnected(false);
    expect(ben.engine.getSnapshot().status).toBe("reconnecting");

    ada.engine.create(NOTE);
    await settle();
    expect(ben.engine.getSnapshot().objects).toHaveLength(0);

    ben.engine.setRealtimeConnected(true);
    await settle();
    expect(ben.engine.getSnapshot().status).toBe("saved");
    expect(ben.engine.getSnapshot().objects).toHaveLength(1);
  });
});

describe("failures", () => {
  it("stops and reports when access is lost, without discarding unsent work", async () => {
    const server = new FakeBoardServer();
    const { engine, store, notices } = connect(server, "ada");
    server.failNext("BOARD_ACCESS_DENIED", 1);
    engine.create(NOTE);
    await settle();

    expect(engine.getSnapshot()).toMatchObject({ status: "failed", failure: "BOARD_ACCESS_DENIED", pendingCount: 1 });
    expect(store.load()).toHaveLength(1);
    expect(notices.at(-1)).toMatchObject({ kind: "sync-failed", code: "BOARD_ACCESS_DENIED" });

    // Nothing further is sent until the person acts.
    const calls = server.submitCalls.length;
    engine.create(NOTE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.submitCalls.length).toBe(calls);

    engine.retry();
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", pendingCount: 0 });
    expect(server.lastSequence).toBe(2);
  });

  it("treats an expired session as a blocking failure", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    server.failNext("UNAUTHENTICATED", 1);
    engine.create(NOTE);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: "failed", failure: "UNAUTHENTICATED", pendingCount: 1 });
  });

  it("drops an operation the server rejects as invalid and carries on", async () => {
    const server = new FakeBoardServer();
    const { engine, notices } = connect(server, "ada");
    server.failNext("VALIDATION_FAILED", 1);
    const bad = engine.create(NOTE)!;
    const good = engine.create({ ...NOTE, x: 400 })!;
    await settle();

    expect(notices).toEqual([expect.objectContaining({ kind: "rejected", code: "VALIDATION_FAILED" })]);
    expect(engine.getSnapshot().objects.map((o) => o.id)).toEqual([good]);
    expect(server.objects.has(bad)).toBe(false);
    expect(engine.getSnapshot().status).toBe("saved");
  });

  it("only discards unsent work when explicitly told to", async () => {
    const server = new FakeBoardServer();
    const { engine, store } = connect(server, "ada");
    engine.setOnline(false);
    engine.create(NOTE);
    expect(engine.getSnapshot().pendingCount).toBe(1);
    engine.discardPending();
    expect(engine.getSnapshot()).toMatchObject({ pendingCount: 0, objects: [] });
    expect(store.load()).toEqual([]);
  });
});

describe("conflicts", () => {
  it("adopts the server's text when a stale text edit is rejected", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    await settle();

    // Both edit the same text from version 1; Ben is offline so his arrives second.
    ben.engine.setOnline(false);
    ben.engine.update(id, { props: { text: "Ben's wording" } });
    ada.engine.update(id, { props: { text: "Ada's wording" } });
    await settle();
    ben.unsubscribe();
    ben.engine.setOnline(true);
    await settle();

    expect(server.objects.get(id)?.props.text).toBe("Ada's wording");
    expect(ben.engine.getSnapshot().byId.get(id)?.props.text).toBe("Ada's wording");
    expect(ben.engine.getSnapshot()).toMatchObject({ pendingCount: 0, status: "saved" });
    expect(ben.notices).toEqual([expect.objectContaining({ kind: "conflict", code: "TEXT_CONFLICT" })]);
  });

  it("resolves concurrent moves as last accepted wins on every client", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    await settle();

    ada.engine.move(id, { x: 100, y: 0 });
    ben.engine.move(id, { x: 200, y: 0 });
    await settle();

    expect(server.objects.get(id)).toMatchObject({ x: 200, version: 3 });
    expect(ada.engine.getSnapshot().byId.get(id)?.x).toBe(200);
    expect(ben.engine.getSnapshot().byId.get(id)?.x).toBe(200);
    expect(ada.notices).toEqual([]);
    expect(ben.notices).toEqual([]);
  });

  it("lets a delete win over an edit queued by someone else", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    await settle();

    ben.engine.setOnline(false);
    ben.engine.move(id, { x: 300, y: 300 });
    ada.engine.remove(id);
    await settle();
    ben.engine.setOnline(true);
    await settle();

    expect(server.objects.get(id)?.deleted).toBe(true);
    expect(ben.engine.getSnapshot().objects).toEqual([]);
    expect(ben.engine.getSnapshot().pendingCount).toBe(0);
    expect(ben.notices.some((n) => n.code === "OBJECT_DELETED")).toBe(true);
  });
});

describe("undo and redo", () => {
  it("undoes and redoes the user's own changes as new operations", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const id = engine.create(NOTE)!;
    engine.move(id, { x: 340, y: 76 });
    await settle();

    expect(engine.undo()).toBe(true);
    await settle();
    expect(server.objects.get(id)).toMatchObject({ x: 0, y: 0, version: 3 });

    expect(engine.redo()).toBe(true);
    await settle();
    expect(server.objects.get(id)).toMatchObject({ x: 340, y: 76, version: 4 });

    // History is appended to, never rewritten.
    expect(server.log.map((o) => o.type)).toEqual(["OBJECT_CREATED", "OBJECT_MOVED", "OBJECT_MOVED", "OBJECT_MOVED"]);
  });

  it("undoes a create by deleting, and redoes it by restoring the same object", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const id = engine.create(NOTE)!;
    await settle();
    engine.undo();
    await settle();
    expect(engine.getSnapshot().objects).toEqual([]);
    expect(server.objects.get(id)?.deleted).toBe(true);
    engine.redo();
    await settle();
    expect(engine.getSnapshot().objects.map((o) => o.id)).toEqual([id]);
    expect(server.log.map((o) => o.type)).toEqual(["OBJECT_CREATED", "OBJECT_DELETED", "OBJECT_RESTORED"]);
  });

  it("restores previous text and style", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const id = engine.create({ ...NOTE, props: { text: "Before", fill: "#F8DD72" } })!;
    engine.update(id, { props: { text: "After", fill: "#A8DDB2" } });
    await settle();
    engine.undo();
    await settle();
    expect(server.objects.get(id)?.props).toEqual({ text: "Before", fill: "#F8DD72" });
  });

  it("refuses to undo a change after someone else has edited the object", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    const id = ada.engine.create(NOTE)!;
    ada.engine.move(id, { x: 100, y: 0 });
    await settle();

    ben.engine.move(id, { x: 555, y: 0 });
    await settle();

    expect(ada.engine.undo()).toBe(false);
    await settle();
    expect(ada.notices.at(-1)).toMatchObject({ kind: "undo-blocked" });
    // Ben's move is untouched.
    expect(server.objects.get(id)).toMatchObject({ x: 555, version: 3 });
  });

  it("never undoes another user's operation", async () => {
    const server = new FakeBoardServer();
    const ada = connect(server, "ada");
    const ben = connect(server, "ben");
    ada.engine.create(NOTE);
    await settle();
    expect(ben.engine.getSnapshot().canUndo).toBe(false);
    expect(ben.engine.undo()).toBe(false);
    await settle();
    expect(server.lastSequence).toBe(1);
  });

  it("clears redo when a new edit is made", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const id = engine.create(NOTE)!;
    engine.move(id, { x: 10, y: 10 });
    await settle();
    engine.undo();
    expect(engine.getSnapshot().canRedo).toBe(true);
    engine.move(id, { x: 77, y: 77 });
    expect(engine.getSnapshot().canRedo).toBe(false);
  });
});

describe("subscription", () => {
  it("notifies subscribers and returns a stable snapshot between changes", async () => {
    const server = new FakeBoardServer();
    const { engine } = connect(server, "ada");
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    const before = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(before);

    engine.create(NOTE);
    expect(listener).toHaveBeenCalled();
    expect(engine.getSnapshot()).not.toBe(before);

    unsubscribe();
    listener.mockClear();
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});
