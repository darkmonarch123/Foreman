"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/dal";
import { fieldErrors } from "@/lib/auth/schemas";
import { actionFailure, actionSuccess, AppError, toAppError, type ActionResult } from "@/lib/errors";
import { getPublicEnv } from "@/lib/env";
import { logServerError, newRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import {
  boardIdSchema,
  COLLABORATION_CODE_PATTERN,
  createBoardSchema,
  joinSchema,
  normalizeCollaborationCode,
  updateBoardSchema,
} from "./schemas";
import type { JoinResult } from "./types";

/**
 * Board Server Actions.
 *
 * Each action checks for a session, validates its input, and then calls a
 * database function that performs the real authorization against
 * board_members. The actions never pass a user id: the database reads it from
 * the session token.
 */

async function call<T>(scope: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  if (!getPublicEnv()) return actionFailure(new AppError("NOT_CONFIGURED"));
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "UNKNOWN") logServerError(scope, error, newRequestId());
    return actionFailure(appError);
  }
  return actionSuccess(data as T);
}

function invalid(error: z.ZodError): ActionResult<never> {
  return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(error));
}

export async function createBoardAction(
  input: unknown,
): Promise<ActionResult<{ id: string; collaboration_code: string }>> {
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<{ id: string; collaboration_code: string }>("boards.create", "create_board", {
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_access_mode: parsed.data.accessMode,
    p_template_slug: parsed.data.templateSlug ?? null,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function updateBoardAction(input: unknown): Promise<ActionResult<{ title: string; description: string }>> {
  const parsed = updateBoardSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<{ title: string; description: string }>("boards.update", "update_board", {
    p_board_id: parsed.data.boardId,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

async function boardCall(scope: string, fn: string, input: unknown): Promise<ActionResult<null>> {
  const parsed = boardIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<null>(scope, fn, { p_board_id: parsed.data.boardId });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function deleteBoardAction(input: unknown): Promise<ActionResult<null>> {
  return boardCall("boards.delete", "delete_board", input);
}

export async function restoreBoardAction(input: unknown): Promise<ActionResult<null>> {
  return boardCall("boards.restore", "restore_board", input);
}

export async function purgeBoardAction(input: unknown): Promise<ActionResult<null>> {
  return boardCall("boards.purge", "purge_board", input);
}

export async function duplicateBoardAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = boardIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<{ id: string }>("boards.duplicate", "duplicate_board", {
    p_board_id: parsed.data.boardId,
    p_title: null,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function leaveBoardAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = boardIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const result = await call<null>("boards.leave", "remove_member", {
    p_board_id: parsed.data.boardId,
    // Always the caller's own id, taken from the session.
    p_user_id: profile.id,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

/**
 * Resolves a collaboration code or share-link token. The database returns a
 * status rather than an error for every "cannot join" case, and uses the same
 * status for a private board as for one that does not exist.
 */
export async function joinBoardAction(input: unknown): Promise<ActionResult<JoinResult>> {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  if (parsed.data.code !== undefined) {
    const code = normalizeCollaborationCode(parsed.data.code);
    if (!COLLABORATION_CODE_PATTERN.test(code)) {
      // Malformed codes get the same answer as unknown ones, without a database round trip.
      return actionSuccess<JoinResult>({ status: "UNAVAILABLE" });
    }
    const result = await call<JoinResult>("boards.join", "join_board", { p_code: code, p_token: null });
    if (result.ok && result.data.board_id) revalidatePath("/dashboard");
    return result;
  }

  const result = await call<JoinResult>("boards.join", "join_board", { p_code: null, p_token: parsed.data.token });
  if (result.ok && result.data.board_id) revalidatePath("/dashboard");
  return result;
}

const invitationIdSchema = z.object({ invitationId: z.uuid() });
const invitationTokenSchema = z.object({ token: z.string().regex(/^[0-9a-f]{32,128}$/) });

export async function acceptInvitationAction(
  input: unknown,
): Promise<ActionResult<{ board_id: string; role: string }>> {
  const byId = invitationIdSchema.safeParse(input);
  const byToken = invitationTokenSchema.safeParse(input);
  if (!byId.success && !byToken.success) {
    return actionFailure(new AppError("INVITATION_UNAVAILABLE"));
  }
  const result = await call<{ board_id: string; role: string }>("invitations.accept", "accept_invitation", {
    p_invitation_id: byId.success ? byId.data.invitationId : null,
    p_token: byToken.success ? byToken.data.token : null,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function declineInvitationAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<null>("invitations.decline", "decline_invitation", {
    p_invitation_id: parsed.data.invitationId,
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

const decideSchema = z.object({
  requestId: z.uuid(),
  approve: z.boolean(),
  role: z.enum(["EDITOR", "VIEWER"]).optional(),
});

export async function decideJoinRequestAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await call<null>("requests.decide", "decide_join_request", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_role: parsed.data.role ?? "VIEWER",
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
