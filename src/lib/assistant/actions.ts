"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/dal";
import { fieldErrors } from "@/lib/auth/schemas";
import type { CanvasObject } from "@/lib/board/types";
import { getPublicEnv } from "@/lib/env";
import { actionFailure, actionSuccess, AppError, toAppError, type ActionResult } from "@/lib/errors";
import { logServerError, newRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { analyze } from "./analyze";
import { isAssistantEnabled } from "./flag";
import { boardOnlySchema, editProposalSchema, proposalIdSchema, runAnalysisSchema } from "./schemas";
import { errorCode, logAssistant } from "./telemetry";
import { timedQuery } from "@/lib/perf/queries";
import { logPerf } from "@/lib/perf/server";
import type { AssistantAcceptResult, AssistantProposalRecord, AssistantRunResult, Finding } from "./types";

/**
 * Foreman Assistant Server Actions.
 *
 * Every action, in this order:
 *   1. checks the feature flag (the flag is enforced here, not only in the UI)
 *   2. checks there is a signed-in user (identity comes from the session JWT)
 *   3. validates input with Zod
 *   4. calls the database as that user, so RLS and the role checks in the
 *      database functions decide what is allowed
 *
 * No action accepts a user id, a role, or a status. Analysis reads board data
 * that is already available to the caller and runs the rule engine in this
 * process; nothing is sent to any other service. Writes happen only through
 * the assistant_* database functions, and an accepted proposal is applied by
 * public.submit_operation, the same function the board UI uses.
 */

async function context(scope: string): Promise<{ supabase: SupabaseClient; requestId: string; userId: string }> {
  const requestId = newRequestId();
  if (!isAssistantEnabled()) {
    logAssistant(scope, { requestId, outcome: "disabled" });
    throw new AppError("ASSISTANT_DISABLED");
  }
  if (!getPublicEnv()) throw new AppError("NOT_CONFIGURED");
  const profile = await getCurrentProfile();
  if (!profile) throw new AppError("UNAUTHENTICATED");
  return { supabase: await createClient(), requestId, userId: profile.id };
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw Object.assign(new AppError("VALIDATION_FAILED"), { fields: fieldErrors(parsed.error) });
  }
  return parsed.data;
}

async function rpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await timedQuery(fn, () => supabase.rpc(fn, args));
  if (error) throw toAppError(error);
  return data as T;
}

function fail(scope: string, requestId: string | undefined, error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  if (appError.code === "UNKNOWN") logServerError(scope, error, requestId);
  const fields = (error as { fields?: Record<string, string> } | null)?.fields;
  return actionFailure(appError, fields);
}

// -- analysis ----------------------------------------------------------------

/** What assistant_board_snapshot returns for each live object: geometry, version and text only. */
interface SnapshotObject {
  id: string;
  type: CanvasObject["type"];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number | string;
  version: number;
  props: { text?: string };
}

interface BoardSnapshot {
  role: "OWNER" | "EDITOR" | "VIEWER";
  objects: SnapshotObject[];
  comments: { id: string; object_id: string | null }[];
}

function toCanvasObject(row: SnapshotObject): CanvasObject {
  return {
    ...row,
    z_index: Number(row.z_index),
    props: row.props ?? {},
    deleted: false,
    created_by: null,
    updated_by: null,
    updated_at: "",
  };
}

export async function runAssistantAnalysis(input: unknown): Promise<ActionResult<AssistantRunResult>> {
  const started = Date.now();
  let requestId: string | undefined;
  let perfContext: { boardId?: string; userId?: string } | undefined;
  try {
    const ctx = await context("assistant.run");
    requestId = ctx.requestId;
    perfContext = { userId: ctx.userId };
    const request = parse(runAnalysisSchema, input);
    perfContext.boardId = request.boardId;
    const { supabase } = ctx;

    // One round trip. Before reading anything, the database checks membership (a non-member gets
    // BOARD_NOT_FOUND), that a viewer is not asking to Propose a plan, and that the run limits are
    // not used up; a refused request reads nothing. It then returns only what the rules use: live
    // objects' geometry, version and text (no drawing data or styles) and comment ids with their
    // anchors (never comment text). assistant_create_run checks again, and counts the run.
    const snapshot = await rpc<BoardSnapshot>(supabase, "assistant_board_snapshot", {
      p_board_id: request.boardId,
      p_action: request.action,
    });
    const canvas = snapshot.objects.map(toCanvasObject);
    const selectedId = request.context.kind === "object" ? request.context.objectId : null;
    if (selectedId && !canvas.some((object) => object.id === selectedId)) {
      throw new AppError("OBJECT_NOT_FOUND");
    }

    const result = analyze({
      action: request.action,
      objects: canvas,
      comments: snapshot.comments,
      context: request.context,
      guidance: request.guidance,
    });

    const proposals = await rpc<AssistantProposalRecord[]>(supabase, "assistant_create_run", {
      p_board_id: request.boardId,
      p_context_kind: request.context.kind,
      p_context_object_id: request.context.kind === "object" ? request.context.objectId : null,
      p_action: request.action,
      p_guidance: request.guidance ?? null,
      p_findings: result.findings.map(findingPayload),
    });

    logPerf({
      action: "assistant_run",
      source: "server",
      durationMs: Date.now() - started,
      outcome: "ok",
      boardId: request.boardId,
      userId: ctx.userId,
    });
    logAssistant("assistant.run", {
      requestId,
      action: request.action,
      contextKind: request.context.kind,
      findings: proposals.length,
      outcome: "ok",
      durationMs: Date.now() - started,
    });
    return actionSuccess({
      proposals,
      exclusions: result.exclusions,
      guidanceIgnored: result.guidanceIgnored,
      truncated: result.truncated,
    });
  } catch (error) {
    logPerf({
      action: "assistant_run",
      source: "server",
      durationMs: Date.now() - started,
      outcome: "error",
      code: errorCode(error),
      ...(perfContext ?? {}),
    });
    logAssistant("assistant.run", {
      requestId: requestId ?? "none",
      outcome: "error",
      code: errorCode(error),
      durationMs: Date.now() - started,
    });
    return fail("assistant.run", requestId, error);
  }
}

/** Exactly the fields the database stores. Nothing else from a finding is sent. */
function findingPayload(finding: Finding) {
  return {
    rule_id: finding.rule_id,
    title: finding.title,
    explanation: finding.explanation,
    label: finding.label,
    severity: finding.severity,
    confidence: finding.confidence,
    evidence: finding.evidence,
    proposal: finding.proposal,
    target_object_id: finding.target_object_id,
    target_object_version: finding.target_object_version,
  };
}

// -- reading and reviewing ----------------------------------------------------

export async function getAssistantProposals(input: unknown): Promise<ActionResult<AssistantProposalRecord[]>> {
  let requestId: string | undefined;
  try {
    const ctx = await context("assistant.list");
    requestId = ctx.requestId;
    const { boardId } = parse(boardOnlySchema, input);
    return actionSuccess(
      await rpc<AssistantProposalRecord[]>(ctx.supabase, "assistant_list_proposals", {
        p_board_id: boardId,
        p_limit: 50,
      }),
    );
  } catch (error) {
    return fail("assistant.list", requestId, error);
  }
}

export async function markAssistantProposalViewed(input: unknown): Promise<ActionResult<null>> {
  let requestId: string | undefined;
  try {
    const ctx = await context("assistant.view");
    requestId = ctx.requestId;
    const { proposalId } = parse(proposalIdSchema, input);
    await rpc<null>(ctx.supabase, "assistant_mark_viewed", { p_proposal_id: proposalId });
    return actionSuccess(null);
  } catch (error) {
    return fail("assistant.view", requestId, error);
  }
}

export async function editAssistantProposal(input: unknown): Promise<ActionResult<AssistantProposalRecord>> {
  let requestId: string | undefined;
  try {
    const ctx = await context("assistant.edit");
    requestId = ctx.requestId;
    const { proposalId, proposal } = parse(editProposalSchema, input);
    return actionSuccess(
      await rpc<AssistantProposalRecord>(ctx.supabase, "assistant_edit_proposal", {
        p_proposal_id: proposalId,
        p_proposal: proposal,
      }),
    );
  } catch (error) {
    return fail("assistant.edit", requestId, error);
  }
}

export async function rejectAssistantProposal(input: unknown): Promise<ActionResult<AssistantProposalRecord>> {
  let requestId: string | undefined;
  try {
    const ctx = await context("assistant.reject");
    requestId = ctx.requestId;
    const { proposalId } = parse(proposalIdSchema, input);
    const proposal = await rpc<AssistantProposalRecord>(ctx.supabase, "assistant_reject_proposal", {
      p_proposal_id: proposalId,
    });
    logAssistant("assistant.reject", { requestId, outcome: "rejected" });
    return actionSuccess(proposal);
  } catch (error) {
    return fail("assistant.reject", requestId, error);
  }
}

/**
 * Accepts and applies one proposal. The database does the whole sequence in one transaction
 * with the proposal row locked: permission, "still pending", target and evidence versions,
 * creating the object through submit_operation, and the audit events. The idempotency key is
 * `assistant:<proposal-id>`, from which the operation id and object id are derived, so a
 * retry returns the original result and can never create a second object.
 */
export async function acceptAssistantProposal(input: unknown): Promise<ActionResult<AssistantAcceptResult>> {
  const started = Date.now();
  let requestId: string | undefined;
  let perfContext: { boardId?: string; userId?: string } | undefined;
  try {
    const ctx = await context("assistant.accept");
    requestId = ctx.requestId;
    const { boardId, proposalId } = parse(proposalIdSchema, input);
    perfContext = { boardId, userId: ctx.userId };
    const result = await rpc<AssistantAcceptResult>(ctx.supabase, "assistant_accept_proposal", {
      p_proposal_id: proposalId,
    });
    logPerf({
      action: "proposal_accept",
      source: "server",
      durationMs: Date.now() - started,
      outcome:
        result.status === "applied" || result.status === "already_applied"
          ? "ok"
          : result.status === "stale"
            ? "stale"
            : result.status === "failed"
              ? "error"
              : "rejected",
      ...(result.status === "failed" ? { code: result.code } : {}),
      ...perfContext,
    });
    logAssistant("assistant.accept", {
      requestId,
      outcome:
        result.status === "applied" || result.status === "already_applied"
          ? "applied"
          : result.status === "stale"
            ? "stale"
            : result.status === "failed"
              ? "failed"
              : "denied",
      ...(result.status === "failed" ? { code: result.code } : {}),
    });
    return actionSuccess(result);
  } catch (error) {
    logPerf({
      action: "proposal_accept",
      source: "server",
      durationMs: Date.now() - started,
      outcome: "error",
      code: errorCode(error),
      ...(perfContext ?? {}),
    });
    return fail("assistant.accept", requestId, error);
  }
}
