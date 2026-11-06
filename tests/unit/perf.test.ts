import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUserId: async () => session.userId }));

import { POST } from "@/app/api/perf/route";
import { clientPerfEventSchema, PERF_ACTIONS } from "@/lib/perf/events";
import { queryLog, resetQueryLog, timedQuery } from "@/lib/perf/queries";
import { logPerf, timeServer } from "@/lib/perf/server";

const USER = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.spyOn(console, "info").mockImplementation((line) => void lines.push(String(line)));
  session.userId = USER;
});

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/perf", { method: "POST", body: JSON.stringify(body) }));

describe("performance events", () => {
  it("covers every action the brief asks to measure", () => {
    expect([...PERF_ACTIONS].sort()).toEqual(
      [
        "assistant_run",
        "board_open",
        "canvas_first_interaction",
        "comment_create",
        "dashboard_load",
        "object_create",
        "object_move",
        "proposal_accept",
        "template_search",
      ].sort(),
    );
  });

  it("has no room for content: unknown fields, free-text codes and user ids are rejected", () => {
    const base = { action: "object_create", durationMs: 12, outcome: "ok" };
    expect(clientPerfEventSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { text: "secret note" },
      { guidance: "do not include billing" },
      { userId: USER },
      { props: { text: "x" } },
      { code: "That email and password don't match" },
    ]) {
      expect(clientPerfEventSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("logs exactly the allowed fields", () => {
    logPerf({
      action: "board_open",
      source: "server",
      durationMs: 12.345,
      outcome: "ok",
      boardId: BOARD,
      userId: USER,
    });
    const entry = JSON.parse(lines[0]);
    expect(Object.keys(entry).sort()).toEqual(
      ["action", "at", "boardId", "durationMs", "level", "outcome", "scope", "source", "userId"].sort(),
    );
    expect(entry).toMatchObject({ scope: "perf", action: "board_open", durationMs: 12.3, outcome: "ok" });
  });

  it("times server work and records failures by error code only", async () => {
    await expect(
      timeServer("assistant_run", { boardId: BOARD, userId: USER }, async () => {
        throw new Error("contains Secret note text");
      }),
    ).rejects.toThrow();
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ action: "assistant_run", outcome: "error", code: "UNKNOWN" });
    expect(lines.join("\n")).not.toContain("Secret");
  });
});

describe("/api/perf", () => {
  it("logs valid client events with the session's user id, ignoring any id in the body", async () => {
    const response = await post({
      events: [{ action: "object_create", durationMs: 8, outcome: "ok", boardId: BOARD }],
    });
    expect(response.status).toBe(204);
    expect(JSON.parse(lines[0])).toMatchObject({ source: "client", action: "object_create", userId: USER });
  });

  it("drops events from anonymous callers", async () => {
    session.userId = null;
    await post({ events: [{ action: "object_create", durationMs: 8, outcome: "ok" }] });
    expect(lines).toEqual([]);
  });

  it("drops a malformed event without losing the rest of the batch", async () => {
    await post({
      events: [
        { action: "object_create", durationMs: 8, outcome: "ok", text: "secret note" },
        { action: "object_move", durationMs: 4, outcome: "ok" },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret");
    expect(JSON.parse(lines[0]).action).toBe("object_move");
  });

  it("ignores oversized, non-JSON and too-large batches", async () => {
    await POST(new Request("http://localhost/api/perf", { method: "POST", body: "x".repeat(9_000) }));
    await POST(new Request("http://localhost/api/perf", { method: "POST", body: "not json" }));
    await post({ events: Array.from({ length: 21 }, () => ({ action: "object_move", durationMs: 1, outcome: "ok" })) });
    expect(lines).toEqual([]);
  });
});

describe("query timing", () => {
  it("records each round trip by name only", async () => {
    resetQueryLog();
    await timedQuery("load_board_state", async () => ({ data: { secret: "board" } }));
    expect(queryLog()).toEqual([{ name: "load_board_state", ms: expect.any(Number) }]);
  });
});
