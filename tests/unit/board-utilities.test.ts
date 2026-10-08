import { describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_ACTIVITY, colorForUser, describeActivity } from "@/lib/board/activity-text";
import { backoffDelay } from "@/lib/board/backoff";
import { defaultPayload, describeObject } from "@/lib/board/defaults";
import {
  drawBoard,
  exportFileName,
  fullBoardBounds,
  planExport,
  wrapText,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
} from "@/lib/board/export";
import {
  arrowHead,
  clampZoom,
  contentBounds,
  fitCamera,
  objectBounds,
  resizeBounds,
  screenToWorld,
  simplifyStroke,
  strokeToObject,
  worldToScreen,
  zoomAt,
} from "@/lib/board/geometry";
import { createLocalPendingStore, pendingStorageKey } from "@/lib/board/storage";
import {
  parseActivityEvent,
  parseCommentEvent,
  parseCursor,
  parseServerOperation,
} from "@/lib/board/supabase-services";
import { TOOLS, isTypingTarget, shortcutList, toolForKey } from "@/lib/board/tools";
import type { CanvasObject, PendingOperation } from "@/lib/board/types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function object(overrides: Partial<CanvasObject> = {}): CanvasObject {
  return {
    id: A,
    type: "STICKY_NOTE",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    z_index: 1,
    props: { text: "hello" },
    version: 1,
    deleted: false,
    created_by: null,
    updated_by: null,
    updated_at: "",
    ...overrides,
  };
}

describe("geometry", () => {
  it("round-trips between screen and world coordinates", () => {
    const camera = { x: -120, y: 40, zoom: 1.5 };
    const world = screenToWorld(camera, { x: 300, y: 150 });
    expect(world).toEqual({ x: 80, y: 140 });
    expect(worldToScreen(camera, world)).toEqual({ x: 300, y: 150 });
  });

  it("zooms around an anchor without moving the point under it", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(camera, anchor);
    const zoomed = zoomAt(camera, anchor, 2);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(clampZoom(100)).toBe(4);
    expect(clampZoom(0)).toBe(0.1);
  });

  it("normalises arrow bounds with negative deltas", () => {
    expect(objectBounds({ x: 100, y: 100, width: -40, height: -30 })).toEqual({ x: 60, y: 70, width: 40, height: 30 });
  });

  it("computes padded content bounds and a camera that fits them", () => {
    const bounds = contentBounds([object(), object({ x: 300, y: 200 })], 10)!;
    expect(bounds).toEqual({ x: -10, y: -10, width: 420, height: 270 });
    const camera = fitCamera(bounds, { width: 840, height: 540 }, 1);
    expect(camera.zoom).toBe(1);
    expect(contentBounds([])).toBeNull();
  });

  it("resizes from each corner and enforces a minimum size", () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    expect(resizeBounds(start, "se", 50, 20)).toEqual({ x: 0, y: 0, width: 150, height: 120 });
    expect(resizeBounds(start, "nw", 30, 40)).toEqual({ x: 30, y: 40, width: 70, height: 60 });
    expect(resizeBounds(start, "se", -500, -500)).toEqual({ x: 0, y: 0, width: 24, height: 24 });
    expect(resizeBounds(start, "nw", 500, 500)).toEqual({ x: 76, y: 76, width: 24, height: 24 });
  });

  it("simplifies and caps freehand strokes, keeping both ends", () => {
    const points = Array.from({ length: 5000 }, (_, index) => ({ x: index * 0.2, y: 0 }));
    const simple = simplifyStroke(points, 2, 100);
    expect(simple.length).toBeLessThanOrEqual(100);
    expect(simple[0]).toEqual(points[0]);
    expect(simple.at(-1)).toEqual(points.at(-1));

    const stroke = strokeToObject([
      { x: 10, y: 20 },
      { x: 30, y: 60 },
    ]);
    expect(stroke).toEqual({ x: 10, y: 20, width: 20, height: 40, points: [0, 0, 20, 40] });
  });

  it("puts the arrowhead tip at the end of the line", () => {
    const [tip, left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(left.x).toBeLessThan(100);
    expect(left.y).toBeCloseTo(-right.y);
  });
});

describe("export planning", () => {
  it("wraps on words, honours newlines and breaks over-long words", () => {
    const measure = (text: string) => text.length * 10;
    expect(wrapText("one two three", 70, measure)).toEqual(["one two", "three"]);
    expect(wrapText("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
    expect(wrapText("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("uses the requested scale when it fits and shrinks when it would exceed browser limits", () => {
    expect(planExport({ x: 0, y: 0, width: 1000, height: 500 }, 2)).toMatchObject({
      scale: 2,
      width: 2000,
      height: 1000,
    });
    const huge = planExport({ x: 0, y: 0, width: 40_000, height: 30_000 }, 2);
    expect(huge.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(huge.height).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_EXPORT_PIXELS * 1.01);
  });

  it("returns no bounds for an empty board", () => {
    expect(fullBoardBounds([])).toBeNull();
    expect(fullBoardBounds([object()], 48)).toEqual({ x: -48, y: -48, width: 196, height: 146 });
  });

  it("names the file after the board and the date", () => {
    expect(exportFileName("Foreman Launch Plan", new Date("2026-10-08T10:00:00Z"))).toBe(
      "foreman-launch-plan-2026-10-08.png",
    );
    expect(exportFileName("../../etc/passwd", new Date("2026-10-08T10:00:00Z"))).toBe("etcpasswd-2026-10-08.png");
    expect(exportFileName("   ", new Date("2026-10-08T10:00:00Z"))).toBe("board-2026-10-08.png");
  });

  it("draws only board objects, skipping deleted ones", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      { measureText: (text: string) => ({ width: text.length * 8 }) },
      {
        get(target, key: string) {
          if (key in target) return (target as Record<string, unknown>)[key];
          return (...args: unknown[]) => void calls.push(`${key}:${typeof args[0] === "string" ? args[0] : ""}`);
        },
        set: () => true,
      },
    );
    const plan = planExport({ x: 0, y: 0, width: 400, height: 300 }, 1);
    drawBoard(
      ctx as never,
      [
        object({ width: 300, props: { text: "Visible note" } }),
        object({ id: B, width: 300, deleted: true, props: { text: "Deleted note" } }),
      ],
      plan,
    );
    expect(calls).toContain("fillText:Visible note");
    expect(calls.join("|")).not.toContain("Deleted note");
    expect(calls[1]).toBe("fillRect:"); // background first
  });
});

describe("realtime payload validation", () => {
  const operation = {
    operation_id: A,
    sequence: 3,
    type: "OBJECT_MOVED",
    object_id: B,
    actor_id: A,
    object: { ...object({ id: B }) },
    server_timestamp: "2026-10-08T00:00:00Z",
  };

  it("accepts a well-formed operation", () => {
    expect(parseServerOperation(operation)).toMatchObject({ sequence: 3, object_id: B });
  });

  it("rejects unknown event types and malformed payloads", () => {
    expect(parseServerOperation({ ...operation, type: "OBJECT_EXPLODED" })).toBeNull();
    expect(parseServerOperation({ ...operation, sequence: "3" })).toBeNull();
    expect(parseServerOperation({ ...operation, sequence: 0 })).toBeNull();
    expect(parseServerOperation({ ...operation, operation_id: "not-a-uuid" })).toBeNull();
    expect(parseServerOperation({ ...operation, object: { ...operation.object, id: A } })).toBeNull();
    expect(parseServerOperation({ ...operation, object: { ...operation.object, type: "IFRAME" } })).toBeNull();
    expect(parseServerOperation({ ...operation, object: null })).toBeNull();
    expect(parseServerOperation("operation")).toBeNull();
    expect(parseServerOperation(null)).toBeNull();
  });

  it("validates cursors", () => {
    expect(parseCursor({ user_id: A, x: 10, y: 20 })).toEqual({ userId: A, x: 10, y: 20 });
    expect(parseCursor({ user_id: "me", x: 10, y: 20 })).toBeNull();
    expect(parseCursor({ user_id: A, x: Number.NaN, y: 0 })).toBeNull();
    expect(parseCursor({ user_id: A, x: 1e12, y: 0 })).toBeNull();
    expect(parseCursor({ user_id: A, x: "10", y: 0 })).toBeNull();
  });

  it("validates comment and activity events", () => {
    expect(parseCommentEvent({ action: "deleted", comment: { id: A } })).toEqual({
      action: "deleted",
      comment: { id: A },
    });
    expect(parseCommentEvent({ action: "created", comment: { id: A, body: "hi" } })?.action).toBe("created");
    expect(parseCommentEvent({ action: "created", comment: { id: A } })).toBeNull();
    expect(parseCommentEvent({ action: "hacked", comment: { id: A, body: "x" } })).toBeNull();
    expect(parseActivityEvent({ id: A, type: "OBJECT_CREATED", actor_id: B })).toMatchObject({ id: A, actor_id: B });
    expect(parseActivityEvent({ id: "x", type: "OBJECT_CREATED" })).toBeNull();
  });
});

describe("pending-operation storage", () => {
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
      clear: () => data.clear(),
      key: (index) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    };
  }
  const pending: PendingOperation = {
    operation_id: A,
    type: "OBJECT_MOVED",
    object_id: B,
    payload: { x: 1, y: 2 },
    expected_version: 1,
    client_timestamp: "2026-10-08T00:00:00Z",
  };

  it("stores only unsent operations, scoped to the user and board", () => {
    const storage = memoryStorage();
    const store = createLocalPendingStore("user-1", "board-1", storage);
    store.save([pending]);
    expect(storage.getItem(pendingStorageKey("user-1", "board-1"))).toContain(A);
    expect(createLocalPendingStore("user-2", "board-1", storage).load()).toEqual([]);
    expect(createLocalPendingStore("user-1", "board-2", storage).load()).toEqual([]);
    expect(store.load()).toEqual([pending]);
    store.save([]);
    expect(storage.length).toBe(0);
  });

  it("discards corrupt or tampered data instead of trusting it", () => {
    const storage = memoryStorage();
    const key = pendingStorageKey("u", "b");
    const store = createLocalPendingStore("u", "b", storage);
    storage.setItem(key, "{not json");
    expect(store.load()).toEqual([]);
    storage.setItem(
      key,
      JSON.stringify([pending, { ...pending, type: "DROP_TABLE" }, { ...pending, operation_id: "x" }, 42, null]),
    );
    expect(store.load()).toEqual([pending]);
    storage.setItem(key, JSON.stringify({ not: "an array" }));
    expect(store.load()).toEqual([]);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    } as unknown as Storage;
    const store = createLocalPendingStore("u", "b", broken);
    expect(store.load()).toEqual([]);
    expect(() => store.save([pending])).not.toThrow();
  });
});

describe("misc", () => {
  it("backs off exponentially with jitter, up to a cap", () => {
    expect(backoffDelay(0, { random: () => 1 })).toBe(500);
    expect(backoffDelay(3, { random: () => 1 })).toBe(4000);
    expect(backoffDelay(20, { random: () => 1 })).toBe(30_000);
    expect(backoffDelay(3, { random: () => 0.5 })).toBe(2000);
    const spy = vi.fn(() => 0);
    expect(backoffDelay(5, { random: spy })).toBe(0);
  });

  it("maps keys to tools and ignores typing targets", () => {
    expect(toolForKey("n")).toBe("sticky");
    expect(toolForKey("V")).toBe("select");
    expect(toolForKey("h")).toBe("hand");
    expect(toolForKey("t")).toBe("text");
    expect(toolForKey("z")).toBeNull();
    expect(new Set(TOOLS.map((tool) => tool.shortcut)).size).toBe(TOOLS.length);
    expect(
      shortcutList(false)
        .flatMap((group) => group.entries)
        .some((entry) => entry.keys.includes("Ctrl K")),
    ).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("describes objects by type and text", () => {
    expect(describeObject({ type: "STICKY_NOTE", props: { text: "  Launch\nplan " } })).toBe(
      "Sticky note: Launch plan",
    );
    expect(describeObject({ type: "STICKY_NOTE", props: {} })).toBe("Sticky note (empty)");
    expect(describeObject({ type: "ARROW", props: {} })).toBe("Arrow");
    expect(describeObject({ type: "TEXT", props: { text: "x".repeat(100) } })).toHaveLength("Text: ".length + 61);
  });

  it("creates sensible defaults for each tool", () => {
    const note = defaultPayload("STICKY_NOTE", { x: 100, y: 100 });
    expect(note).toMatchObject({ type: "STICKY_NOTE", x: 10, y: 30, width: 180, height: 140 });
    expect(note.props.fill).toBe("#F8DD72");
    expect(defaultPayload("ARROW", { x: 5, y: 6 })).toMatchObject({ x: 5, y: 6, width: 180, height: 0 });
  });

  it("describes activity without inventing detail", () => {
    const item = (type: string, metadata: Record<string, unknown> = {}, subject_name: string | null = null) => ({
      type,
      metadata,
      subject_name,
    });
    expect(describeActivity(item("OBJECT_CREATED", { object_type: "STICKY_NOTE" }))).toBe("added a sticky note");
    expect(describeActivity(item("OBJECT_MOVED", { object_type: "ARROW", repeat: 3 }))).toBe(
      "moved an arrow (3 times)",
    );
    expect(describeActivity(item("MEMBER_ROLE_CHANGED", { role: "EDITOR" }, "Ben Mensah"))).toBe(
      "made Ben Mensah an editor",
    );
    expect(describeActivity(item("BOARD_EXPORTED"))).toBe("exported the board as a PNG");
    expect(describeActivity(item("SOMETHING_NEW"))).toBe("made a change");
    expect(MEMBERSHIP_ACTIVITY.has("MEMBER_REMOVED")).toBe(true);
  });

  it("gives each user a stable cursor colour", () => {
    expect(colorForUser(A)).toBe(colorForUser(A));
    expect(colorForUser(A)).toMatch(/^#[0-9A-F]{6}$/);
  });
});
