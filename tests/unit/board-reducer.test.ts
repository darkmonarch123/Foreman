import { describe, expect, it } from "vitest";
import {
  applyLocalOperation,
  applyServerOperation,
  applyServerOperations,
  buildDocument,
  projectView,
  upsertObject,
  visibleObjects,
} from "@/lib/board/reducer";
import type { CanvasObject, PendingOperation, ServerOperation } from "@/lib/board/types";

function object(id: string, overrides: Partial<CanvasObject> = {}): CanvasObject {
  return {
    id,
    type: "STICKY_NOTE",
    x: 0,
    y: 0,
    width: 160,
    height: 120,
    rotation: 0,
    z_index: 1,
    props: { text: "note" },
    version: 1,
    deleted: false,
    created_by: "u1",
    updated_by: "u1",
    updated_at: "2026-10-08T00:00:00Z",
    ...overrides,
  };
}

function serverOp(sequence: number, state: CanvasObject, actor = "u2"): ServerOperation {
  return {
    operation_id: `op-${sequence}`,
    sequence,
    type: "OBJECT_UPDATED",
    object_id: state.id,
    actor_id: actor,
    object: state,
    server_timestamp: "2026-10-08T00:00:00Z",
  };
}

function pending(
  type: PendingOperation["type"],
  objectId: string,
  payload: PendingOperation["payload"],
): PendingOperation {
  return {
    operation_id: crypto.randomUUID(),
    type,
    object_id: objectId,
    payload,
    expected_version: null,
    client_timestamp: "2026-10-08T00:00:01Z",
  };
}

describe("buildDocument", () => {
  it("applies operations after the snapshot in sequence order", () => {
    const document = buildDocument({
      snapshot: { sequence: 5, objects: [object("a"), object("b")] },
      // Deliberately out of order.
      operations: [serverOp(7, object("a", { x: 70, version: 3 })), serverOp(6, object("a", { x: 60, version: 2 }))],
      last_sequence: 7,
    });
    expect(document.lastSequence).toBe(7);
    expect(document.objects.get("a")).toMatchObject({ x: 70, version: 3 });
    expect(document.objects.get("b")).toMatchObject({ x: 0, version: 1 });
  });

  it("handles a board with no operations", () => {
    const document = buildDocument({ snapshot: { sequence: 0, objects: [] }, operations: [], last_sequence: 0 });
    expect(document.lastSequence).toBe(0);
    expect(document.objects.size).toBe(0);
  });
});

describe("applyServerOperation", () => {
  const base = buildDocument({ snapshot: { sequence: 3, objects: [object("a")] }, operations: [], last_sequence: 3 });

  it("applies the next sequence", () => {
    const result = applyServerOperation(base, serverOp(4, object("a", { x: 9, version: 2 })));
    expect(result.kind).toBe("applied");
    expect(result.document.lastSequence).toBe(4);
    expect(result.document.objects.get("a")?.x).toBe(9);
  });

  it("ignores an operation it has already seen", () => {
    const result = applyServerOperation(base, serverOp(3, object("a", { x: 9, version: 2 })));
    expect(result.kind).toBe("stale");
    expect(result.document).toBe(base);
  });

  it("reports a gap instead of applying out of order", () => {
    const result = applyServerOperation(base, serverOp(6, object("a", { x: 9, version: 4 })));
    expect(result.kind).toBe("gap");
    expect(result.document).toBe(base);
  });

  it("is idempotent for recovery batches that overlap known state", () => {
    const first = applyServerOperations(base, [serverOp(4, object("a", { x: 4, version: 2 }))]);
    const again = applyServerOperations(first, [
      serverOp(4, object("a", { x: 4, version: 2 })),
      serverOp(5, object("a", { x: 5, version: 3 })),
    ]);
    expect(again.lastSequence).toBe(5);
    expect(again.objects.get("a")).toMatchObject({ x: 5, version: 3 });
  });
});

describe("upsertObject", () => {
  it("never replaces a newer version with an older one", () => {
    const objects = new Map([["a", object("a", { version: 5, x: 50 })]]);
    const next = upsertObject(objects, object("a", { version: 4, x: 40 }));
    expect(next).toBe(objects);
    expect(upsertObject(objects, object("a", { version: 6, x: 60 })).get("a")?.x).toBe(60);
  });
});

describe("applyLocalOperation", () => {
  it("creates, moves, updates, deletes and restores", () => {
    const created = applyLocalOperation(
      undefined,
      pending("OBJECT_CREATED", "n", { type: "TEXT", x: 1, y: 2, width: 3, height: 4, props: { text: "hi" } }),
      "me",
    )!;
    expect(created).toMatchObject({ id: "n", type: "TEXT", version: 1, created_by: "me", deleted: false });

    const moved = applyLocalOperation(created, pending("OBJECT_MOVED", "n", { x: 10, y: 20 }), "me")!;
    expect(moved).toMatchObject({ x: 10, y: 20, version: 2 });

    const updated = applyLocalOperation(
      moved,
      pending("OBJECT_UPDATED", "n", { width: 99, props: { fill: "#FFFFFF" } }),
      "me",
    )!;
    expect(updated).toMatchObject({ width: 99, version: 3 });
    expect(updated.props).toEqual({ text: "hi", fill: "#FFFFFF" });

    const deleted = applyLocalOperation(updated, pending("OBJECT_DELETED", "n", {}), "me")!;
    expect(deleted.deleted).toBe(true);
    const restored = applyLocalOperation(deleted, pending("OBJECT_RESTORED", "n", {}), "me")!;
    expect(restored).toMatchObject({ deleted: false, version: 5 });
  });

  it("lets deletion win over later moves and updates", () => {
    const gone = object("a", { deleted: true, version: 2 });
    expect(applyLocalOperation(gone, pending("OBJECT_MOVED", "a", { x: 5, y: 5 }), "me")).toBe(gone);
    expect(applyLocalOperation(gone, pending("OBJECT_UPDATED", "a", { props: { text: "x" } }), "me")).toBe(gone);
  });

  it("does not mutate its input", () => {
    const original = object("a");
    const frozen = Object.freeze({ ...original, props: Object.freeze({ ...original.props }) });
    applyLocalOperation(frozen, pending("OBJECT_UPDATED", "a", { props: { text: "changed" } }), "me");
    expect(frozen.props.text).toBe("note");
  });
});

describe("projectView", () => {
  it("replays pending edits over newer server state", () => {
    const server = new Map([["a", object("a", { x: 0, props: { text: "note", fill: "#F8DD72" } })]]);
    const mine = [pending("OBJECT_MOVED", "a", { x: 100, y: 0 })];
    expect(projectView(server, mine, "me").get("a")?.x).toBe(100);

    // A remote style change arrives while my move is still unacknowledged.
    const newer = upsertObject(server, object("a", { version: 2, props: { text: "note", fill: "#A8DDB2" } }));
    const view = projectView(newer, mine, "me").get("a")!;
    expect(view.x).toBe(100);
    expect(view.props.fill).toBe("#A8DDB2");
  });

  it("returns the same map when nothing is pending", () => {
    const server = new Map([["a", object("a")]]);
    expect(projectView(server, [], "me")).toBe(server);
  });
});

describe("visibleObjects", () => {
  it("hides deleted objects and sorts by z-index", () => {
    const objects = new Map([
      ["top", object("top", { z_index: 9 })],
      ["gone", object("gone", { z_index: 5, deleted: true })],
      ["bottom", object("bottom", { z_index: 1 })],
    ]);
    expect(visibleObjects(objects).map((o) => o.id)).toEqual(["bottom", "top"]);
  });
});
