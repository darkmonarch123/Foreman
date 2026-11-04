import { beforeEach, describe, expect, it, vi } from "vitest";
import { note } from "../support/assistant-fixtures";

/**
 * Assistant Server Actions with Supabase mocked at the client boundary. They check what the
 * actions send and refuse, that nothing leaves the process, and that no content is logged.
 * They do not exercise Supabase itself; the database functions are covered in tests/db.
 */

const mocks = vi.hoisted(() => {
  const state = {
    profile: null as null | Record<string, unknown>,
    objects: [] as Record<string, unknown>[],
    comments: [] as Record<string, unknown>[],
    selects: [] as { table: string; columns: string }[],
  };
  const rpc = vi.fn();
  const from = vi.fn((table: string) => {
    const builder = {
      select(columns: string) {
        state.selects.push({ table, columns });
        return builder;
      },
      eq: () => builder,
      is: () => builder,
      limit: async () => ({ data: table === "canvas_objects" ? state.objects : state.comments, error: null }),
    };
    return builder;
  });
  return { state, rpc, from };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentProfile: async () => mocks.state.profile }));

import {
  acceptAssistantProposal,
  editAssistantProposal,
  getAssistantProposals,
  markAssistantProposalViewed,
  rejectAssistantProposal,
  runAssistantAnalysis,
} from "@/lib/assistant/actions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";

let logs: string[];

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockClear();
  mocks.state.profile = { id: USER_ID };
  mocks.state.objects = [];
  mocks.state.comments = [];
  mocks.state.selects = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("ASSISTANT_ENABLED", "true");
  logs = [];
  vi.spyOn(console, "info").mockImplementation((line) => void logs.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line) => void logs.push(String(line)));
  vi.spyOn(console, "log").mockImplementation((line) => void logs.push(String(line)));
});

/** Database rows for a board object, shaped like the canvas_objects select. */
function row(text: string, id: string, x = 0) {
  const object = note(text, x, 0);
  return { ...object, id, deleted: undefined, z_index: String(object.z_index) };
}

function respondTo(handlers: Record<string, unknown>) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (!(fn in handlers)) return { data: null, error: { message: `unexpected rpc ${fn}`, code: "XX000" } };
    const value = handlers[fn];
    if (value instanceof Error) return { data: null, error: { message: value.message, code: "P0001" } };
    return { data: value, error: null };
  });
}

const request = { boardId: BOARD_ID, action: "find_planning_gaps", context: { kind: "board" } } as const;

describe("the feature flag", () => {
  it("is off by default in production and refuses every action without touching the database", async () => {
    vi.stubEnv("ASSISTANT_ENABLED", "");
    vi.stubEnv("NODE_ENV", "production");
    const results = await Promise.all([
      runAssistantAnalysis(request),
      getAssistantProposals({ boardId: BOARD_ID }),
      acceptAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID }),
      rejectAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID }),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, code: "ASSISTANT_DISABLED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("can be turned on explicitly in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASSISTANT_ENABLED", "true");
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: [] });
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: true });
  });

  it("with ASSISTANT_ENABLED=false refuses all six actions before auth, validation or any database call", async () => {
    vi.stubEnv("ASSISTANT_ENABLED", "false");
    const draft = {
      kind: "create_object",
      object: { type: "STICKY_NOTE", x: 0, y: 0, width: 180, height: 140, props: { text: "Decide: x" } },
    };
    const calls: [string, () => Promise<{ ok: boolean }>][] = [
      ["run", () => runAssistantAnalysis({ ...request, action: "propose_plan" })],
      ["list", () => getAssistantProposals({ boardId: BOARD_ID })],
      ["view", () => markAssistantProposalViewed({ boardId: BOARD_ID, proposalId: PROPOSAL_ID })],
      ["edit", () => editAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID, proposal: draft })],
      ["reject", () => rejectAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID })],
      ["accept", () => acceptAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID })],
    ];
    for (const [name, call] of calls) {
      expect(await call(), name).toMatchObject({ ok: false, code: "ASSISTANT_DISABLED" });
    }
    // Even invalid input and a signed-out caller get the same answer: the flag is checked first.
    mocks.state.profile = null;
    expect(await runAssistantAnalysis({ nonsense: true })).toMatchObject({ code: "ASSISTANT_DISABLED" });
    // Nothing reached Supabase, so no assistant_proposals or assistant_proposal_events row can have been written:
    // the browser has SELECT only on those tables, and these actions are the only writers.
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("can be turned off explicitly", async () => {
    vi.stubEnv("ASSISTANT_ENABLED", "false");
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: false, code: "ASSISTANT_DISABLED" });
  });
});

describe("authentication and input", () => {
  it("requires a signed-in user", async () => {
    mocks.state.profile = null;
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates input before doing anything", async () => {
    const result = await runAssistantAnalysis({ ...request, boardId: "not-a-uuid" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, so a user id or role can never be passed in", async () => {
    for (const extra of [{ userId: USER_ID }, { role: "OWNER" }, { status: "accepted" }]) {
      const result = await acceptAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID, ...extra });
      expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects over-long guidance and unknown actions", async () => {
    expect(await runAssistantAnalysis({ ...request, guidance: "x".repeat(301) })).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(await runAssistantAnalysis({ ...request, action: "delete_board" })).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("runAssistantAnalysis", () => {
  it("does not read board content for a non-member", async () => {
    respondTo({ assistant_check_run: new Error("BOARD_NOT_FOUND") });
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: false, code: "BOARD_NOT_FOUND" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("asks the database to check role and action first, and reads nothing if a viewer asks to Propose a plan", async () => {
    respondTo({ assistant_check_run: new Error("BOARD_ACCESS_DENIED") });
    const result = await runAssistantAnalysis({ ...request, action: "propose_plan" });
    expect(result).toMatchObject({ ok: false, code: "BOARD_ACCESS_DENIED" });
    expect(mocks.rpc).toHaveBeenCalledWith("assistant_check_run", { p_board_id: BOARD_ID, p_action: "propose_plan" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("refuses a rate-limited run before reading the board or running any rules", async () => {
    mocks.state.objects = [row("Who owns onboarding?", "44444444-4444-4444-8444-444444444444")];
    respondTo({ assistant_check_run: new Error("RATE_LIMITED") });
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([fn]) => fn)).toEqual(["assistant_check_run"]);
  });

  it("lets a viewer run Find planning gaps", async () => {
    respondTo({ assistant_check_run: { role: "VIEWER" }, assistant_create_run: [] });
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: true });
  });

  it("analyzes the board, stores only the finding fields, and never sends an identity", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    mocks.state.objects = [row("Who owns onboarding?", id)];
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: [{ id: PROPOSAL_ID }] });

    const result = await runAssistantAnalysis(request);
    expect(result).toMatchObject({ ok: true, data: { proposals: [{ id: PROPOSAL_ID }], truncated: false } });

    const call = mocks.rpc.mock.calls.find(([fn]) => fn === "assistant_create_run");
    expect(call).toBeDefined();
    const args = call![1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      "p_action",
      "p_board_id",
      "p_context_kind",
      "p_context_object_id",
      "p_findings",
      "p_guidance",
    ]);
    const findings = args.p_findings as Record<string, unknown>[];
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        "confidence",
        "evidence",
        "explanation",
        "label",
        "proposal",
        "rule_id",
        "severity",
        "target_object_id",
        "target_object_version",
        "title",
      ]);
    }
  });

  it("never selects comment text", async () => {
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: [] });
    await runAssistantAnalysis(request);
    expect(mocks.state.selects.find((entry) => entry.table === "board_comments")?.columns).toBe("id, object_id");
  });

  it("makes no network request of its own", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mocks.state.objects = [row("Who owns onboarding?", "44444444-4444-4444-8444-444444444444")];
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: [] });
    await runAssistantAnalysis(request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not write note text, guidance or titles to the logs", async () => {
    mocks.state.objects = [row("Secret launch codename Falcon?", "44444444-4444-4444-8444-444444444444")];
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: [{ id: PROPOSAL_ID }] });
    await runAssistantAnalysis({ ...request, guidance: "do not include Zebra" });
    mocks.rpc.mockImplementation(async () => ({
      data: null,
      error: { message: "Falcon leaked in db error", code: "XX000" },
    }));
    await runAssistantAnalysis(request);
    expect(logs.length).toBeGreaterThan(0);
    const joined = logs.join("\n");
    expect(joined).not.toContain("Falcon");
    expect(joined).not.toContain("Zebra");
    expect(joined).not.toMatch(/onboarding|owns/i);
  });

  it("refuses an object context that is not on the board", async () => {
    respondTo({ assistant_check_run: { role: "OWNER" } });
    const result = await runAssistantAnalysis({
      ...request,
      context: { kind: "object", objectId: "55555555-5555-4555-8555-555555555555" },
    });
    expect(result).toMatchObject({ ok: false, code: "OBJECT_NOT_FOUND" });
  });

  it("returns a generic message for an unexpected database error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "secret_table" does not exist', code: "42P01" },
    });
    const result = await runAssistantAnalysis(request);
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN" });
    expect(JSON.stringify(result)).not.toContain("secret_table");
  });

  it("maps a rate limit from the database", async () => {
    respondTo({ assistant_check_run: { role: "OWNER" }, assistant_create_run: new Error("RATE_LIMITED") });
    expect(await runAssistantAnalysis(request)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("reviewing", () => {
  it("lists the caller's proposals for the board", async () => {
    respondTo({ assistant_list_proposals: [{ id: PROPOSAL_ID }] });
    expect(await getAssistantProposals({ boardId: BOARD_ID })).toEqual({ ok: true, data: [{ id: PROPOSAL_ID }] });
    expect(mocks.rpc).toHaveBeenCalledWith("assistant_list_proposals", { p_board_id: BOARD_ID, p_limit: 50 });
  });

  it("records a view", async () => {
    respondTo({ assistant_mark_viewed: null });
    expect(await markAssistantProposalViewed({ boardId: BOARD_ID, proposalId: PROPOSAL_ID })).toEqual({
      ok: true,
      data: null,
    });
  });

  it("rejects an edit to an unsupported object type before it reaches the database", async () => {
    const result = await editAssistantProposal({
      boardId: BOARD_ID,
      proposalId: PROPOSAL_ID,
      proposal: { kind: "create_object", object: { type: "IMAGE", x: 0, y: 0, width: 100, height: 100, props: {} } },
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an edit with unknown style keys or over-long text", async () => {
    const object = { type: "STICKY_NOTE", x: 0, y: 0, width: 180, height: 140 };
    for (const props of [{ onclick: "alert(1)" }, { text: "x".repeat(201) }, { fill: "red" }]) {
      const result = await editAssistantProposal({
        boardId: BOARD_ID,
        proposalId: PROPOSAL_ID,
        proposal: { kind: "create_object", object: { ...object, props } },
      });
      expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends a valid edit through the database function", async () => {
    respondTo({ assistant_edit_proposal: { id: PROPOSAL_ID } });
    const proposal = {
      kind: "create_object",
      object: { type: "STICKY_NOTE", x: 10, y: 20, width: 180, height: 140, props: { text: "Decide: pricing" } },
    };
    const result = await editAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID, proposal });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("assistant_edit_proposal", {
      p_proposal_id: PROPOSAL_ID,
      p_proposal: proposal,
    });
  });
});

describe("acceptAssistantProposal", () => {
  const accept = () => acceptAssistantProposal({ boardId: BOARD_ID, proposalId: PROPOSAL_ID });

  it("applies through the database function, sending only the proposal id", async () => {
    respondTo({ assistant_accept_proposal: { status: "applied", proposal: { id: PROPOSAL_ID }, operation: {} } });
    expect(await accept()).toMatchObject({ ok: true, data: { status: "applied" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("assistant_accept_proposal", { p_proposal_id: PROPOSAL_ID });
  });

  it("returns a stale proposal as a typed result, not an error", async () => {
    respondTo({
      assistant_accept_proposal: { status: "stale", reason: { object_id: "x", reason: "changed" }, proposal: {} },
    });
    expect(await accept()).toMatchObject({ ok: true, data: { status: "stale", reason: { reason: "changed" } } });
  });

  it("returns an apply failure as a typed result", async () => {
    respondTo({ assistant_accept_proposal: { status: "failed", code: "RATE_LIMITED", proposal: {} } });
    expect(await accept()).toMatchObject({ ok: true, data: { status: "failed", code: "RATE_LIMITED" } });
  });

  it("reports a viewer's attempt as an access error", async () => {
    respondTo({ assistant_accept_proposal: new Error("BOARD_ACCESS_DENIED") });
    expect(await accept()).toMatchObject({ ok: false, code: "BOARD_ACCESS_DENIED" });
  });

  it("does not reveal whether someone else's proposal exists", async () => {
    respondTo({ assistant_accept_proposal: new Error("PROPOSAL_NOT_FOUND") });
    expect(await accept()).toMatchObject({ ok: false, code: "PROPOSAL_NOT_FOUND" });
  });

  it("logs the outcome without any content", async () => {
    respondTo({ assistant_accept_proposal: { status: "stale", proposal: {} } });
    await accept();
    expect(logs.some((line) => line.includes('"outcome":"stale"'))).toBe(true);
  });
});
