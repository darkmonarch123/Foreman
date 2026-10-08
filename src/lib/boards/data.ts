import "server-only";

import { AppError, toAppError } from "@/lib/errors";
import type { BoardState, BoardSummary } from "@/lib/board/types";
import type { Member } from "@/lib/board/services";
import { getPublicEnv } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import type { BoardListItem, BoardScope, Notifications, TemplateRow } from "./types";

/**
 * Server-side reads for pages. Every call runs as the signed-in user, so the
 * database decides what comes back; nothing here filters by a user id taken
 * from the request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

async function rpc<T>(scope: string, fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!getPublicEnv()) throw new AppError("NOT_CONFIGURED");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "UNKNOWN") logServerError(scope, error);
    throw appError;
  }
  return data as T;
}

export function listBoards(scope: BoardScope, search?: string, limit = 60): Promise<BoardListItem[]> {
  return rpc<BoardListItem[]>("boards.list", "list_boards", {
    p_scope: scope,
    p_search: search?.slice(0, 120) ?? null,
    p_limit: limit,
  });
}

export function getNotifications(): Promise<Notifications> {
  return rpc<Notifications>("boards.notifications", "get_notifications");
}

/** Returns null (not an error) when the board does not exist or the caller cannot see it. */
export async function getBoard(boardId: string): Promise<BoardSummary | null> {
  if (!isUuid(boardId)) return null;
  try {
    return await rpc<BoardSummary>("boards.get", "get_board", { p_board_id: boardId });
  } catch (error) {
    const code = toAppError(error).code;
    if (code === "BOARD_NOT_FOUND" || code === "BOARD_ACCESS_DENIED") return null;
    throw error;
  }
}

export async function loadBoardState(boardId: string): Promise<BoardState | null> {
  if (!isUuid(boardId)) return null;
  try {
    return await rpc<BoardState>("boards.state", "load_board_state", { p_board_id: boardId });
  } catch (error) {
    const code = toAppError(error).code;
    if (code === "BOARD_NOT_FOUND" || code === "BOARD_ACCESS_DENIED") return null;
    throw error;
  }
}

export function getBoardMembers(boardId: string): Promise<Member[]> {
  return rpc<Member[]>("boards.members", "get_board_members", { p_board_id: boardId });
}

/** The published template catalog, straight from the database. */
export async function listTemplates(): Promise<TemplateRow[]> {
  if (!getPublicEnv()) throw new AppError("NOT_CONFIGURED");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, slug, name, description, category, min_plan, is_featured, sort_order, content")
    .order("sort_order", { ascending: true });
  if (error) {
    logServerError("templates.list", error);
    throw toAppError(error);
  }
  return (data ?? []) as TemplateRow[];
}

export async function getTemplate(slug: string): Promise<TemplateRow | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  if (!getPublicEnv()) throw new AppError("NOT_CONFIGURED");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, slug, name, description, category, min_plan, is_featured, sort_order, content")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    logServerError("templates.get", error);
    throw toAppError(error);
  }
  return (data as TemplateRow | null) ?? null;
}
