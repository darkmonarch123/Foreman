"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "@/lib/errors";
import {
  ACTIVITY_PAGE_SIZE,
  COMMENTS_PAGE_SIZE,
  type ActivityEvent,
  type ActivityItem,
  type BoardComment,
  type BoardRealtime,
  type BoardServices,
  type CommentEvent,
  type CursorPosition,
  type Invitation,
  type JoinRequest,
  type Member,
  type RealtimeHandlers,
  type SharingSettings,
} from "./services";
import { OBJECT_TYPES, OPERATION_TYPES, type BoardSummary, type ServerOperation, type SubmitResult } from "./types";

/**
 * Supabase implementation of the board services.
 *
 * Every call goes out with the signed-in user's JWT and the public anon key.
 * Reads are limited by Row Level Security; writes go through database
 * functions that re-check the caller's role on each call. Nothing here sends
 * a user id or a role for the server to trust.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_INTERVAL_MS = 80;
const CURSOR_LIMIT = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Incoming realtime payloads are validated before they touch board state. */
export function parseServerOperation(value: unknown): ServerOperation | null {
  if (!isRecord(value)) return null;
  const object = value.object;
  if (
    typeof value.operation_id !== "string" ||
    !UUID.test(value.operation_id) ||
    typeof value.sequence !== "number" ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.type !== "string" ||
    !(OPERATION_TYPES as readonly string[]).includes(value.type) ||
    typeof value.object_id !== "string" ||
    !UUID.test(value.object_id) ||
    !isRecord(object) ||
    object.id !== value.object_id ||
    typeof object.type !== "string" ||
    !(OBJECT_TYPES as readonly string[]).includes(object.type) ||
    typeof object.version !== "number" ||
    typeof object.x !== "number" ||
    typeof object.y !== "number" ||
    typeof object.width !== "number" ||
    typeof object.height !== "number" ||
    !isRecord(object.props)
  ) {
    return null;
  }
  return value as unknown as ServerOperation;
}

export function parseCursor(value: unknown): CursorPosition | null {
  if (!isRecord(value)) return null;
  const { user_id: userId, x, y } = value;
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > CURSOR_LIMIT || Math.abs(y) > CURSOR_LIMIT) return null;
  return { userId, x, y };
}

export function parseCommentEvent(value: unknown): CommentEvent | null {
  if (!isRecord(value) || !isRecord(value.comment)) return null;
  const comment = value.comment;
  if (typeof comment.id !== "string" || !UUID.test(comment.id)) return null;
  if (value.action === "deleted") return { action: "deleted", comment: { id: comment.id } };
  if ((value.action === "created" || value.action === "updated") && typeof comment.body === "string") {
    return { action: value.action, comment: comment as unknown as BoardComment };
  }
  return null;
}

export function parseActivityEvent(value: unknown): ActivityEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !UUID.test(value.id) || typeof value.type !== "string") return null;
  return {
    id: value.id,
    type: value.type,
    actor_id: typeof value.actor_id === "string" ? value.actor_id : null,
    object_id: typeof value.object_id === "string" ? value.object_id : null,
    created_at: typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
  };
}

function createRealtime(supabase: SupabaseClient, boardId: string, userId: string): BoardRealtime {
  let cursorChannel: RealtimeChannel | null = null;
  let cursorReady = false;
  let lastSent = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let queued: { x: number; y: number } | null = null;

  function flushCursor() {
    trailing = null;
    if (!queued || !cursorChannel || !cursorReady) return;
    const { x, y } = queued;
    queued = null;
    lastSent = Date.now();
    void cursorChannel.send({ type: "broadcast", event: "cursor", payload: { user_id: userId, x, y } });
  }

  return {
    connect(handlers: RealtimeHandlers) {
      const topic = (name: string) => `board:${boardId}:${name}`;
      const joined = new Map<string, boolean>();
      let closed = false;
      const channels: RealtimeChannel[] = [];
      // Per-sender budget for incoming cursor events: a misbehaving client cannot flood the UI.
      const cursorBudget = new Map<string, { windowStart: number; count: number }>();

      const report = () => {
        if (closed) return;
        handlers.onStatus(joined.size === 5 && [...joined.values()].every(Boolean));
      };

      const track = (name: string, channel: RealtimeChannel, onJoined?: () => void) => {
        joined.set(name, false);
        channels.push(channel);
        channel.subscribe((status) => {
          if (closed) return;
          const ok = status === "SUBSCRIBED";
          joined.set(name, ok);
          if (ok) onJoined?.();
          if (name === "cursors") cursorReady = ok;
          report();
        });
      };

      void (async () => {
        // Private channels are authorised with the user's JWT against the
        // realtime.messages policies.
        await supabase.realtime.setAuth();
        if (closed) return;

        track(
          "operations",
          supabase
            .channel(topic("operations"), { config: { private: true } })
            .on("broadcast", { event: "operation" }, (message) => {
              const operation = parseServerOperation(message.payload);
              if (operation) handlers.onOperation(operation);
            }),
        );

        track(
          "comments",
          supabase
            .channel(topic("comments"), { config: { private: true } })
            .on("broadcast", { event: "comment" }, (message) => {
              const event = parseCommentEvent(message.payload);
              if (event) handlers.onComment(event);
            }),
        );

        track(
          "activity",
          supabase
            .channel(topic("activity"), { config: { private: true } })
            .on("broadcast", { event: "activity" }, (message) => {
              const event = parseActivityEvent(message.payload);
              if (event) handlers.onActivity(event);
            }),
        );

        const presence = supabase.channel(topic("presence"), {
          config: { private: true, presence: { key: userId } },
        });
        presence.on("presence", { event: "sync" }, () => {
          const state = presence.presenceState<{ user_id?: unknown }>();
          const ids = new Set<string>();
          for (const entries of Object.values(state)) {
            for (const entry of entries) {
              if (typeof entry.user_id === "string" && UUID.test(entry.user_id)) ids.add(entry.user_id);
            }
          }
          handlers.onPresence([...ids]);
        });
        track("presence", presence, () => {
          void presence.track({ user_id: userId });
        });

        cursorChannel = supabase
          .channel(topic("cursors"), { config: { private: true, broadcast: { self: false } } })
          .on("broadcast", { event: "cursor" }, (message) => {
            const cursor = parseCursor(message.payload);
            if (!cursor || cursor.userId === userId) return;
            const now = Date.now();
            const budget = cursorBudget.get(cursor.userId);
            if (!budget || now - budget.windowStart > 1000) {
              cursorBudget.set(cursor.userId, { windowStart: now, count: 1 });
            } else if (budget.count >= 30) {
              return;
            } else {
              budget.count += 1;
            }
            handlers.onCursor(cursor);
          });
        track("cursors", cursorChannel);
      })();

      return () => {
        closed = true;
        cursorReady = false;
        if (trailing) clearTimeout(trailing);
        trailing = null;
        queued = null;
        cursorChannel = null;
        for (const channel of channels) void supabase.removeChannel(channel);
      };
    },

    sendCursor(x: number, y: number) {
      if (typeof document !== "undefined" && document.hidden) return;
      queued = { x: Math.round(x), y: Math.round(y) };
      const wait = CURSOR_INTERVAL_MS - (Date.now() - lastSent);
      if (wait <= 0) flushCursor();
      else if (!trailing) trailing = setTimeout(flushCursor, wait);
    },
  };
}

export function createSupabaseBoardServices(supabase: SupabaseClient, boardId: string, userId: string): BoardServices {
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    let response;
    try {
      response = await supabase.rpc(fn, args);
    } catch (error) {
      throw toAppError(error);
    }
    if (response.error) throw toAppError(response.error);
    return response.data as T;
  }

  const board = { p_board_id: boardId };

  return {
    transport: {
      submit: (operation) =>
        rpc<SubmitResult>("submit_operation", {
          ...board,
          p_operation_id: operation.operation_id,
          p_type: operation.type,
          p_object_id: operation.object_id,
          p_payload: operation.payload,
          p_expected_version: operation.expected_version,
          p_client_timestamp: operation.client_timestamp,
        }),
      fetchAfter: (sequence) =>
        rpc<{ operations: ServerOperation[]; last_sequence: number }>("get_operations_after", {
          ...board,
          p_after: sequence,
        }),
    },
    realtime: createRealtime(supabase, boardId, userId),

    getBoard: () => rpc<BoardSummary>("get_board", board),
    loadMembers: () => rpc<Member[]>("get_board_members", board),
    loadComments: (before) =>
      rpc<BoardComment[]>("get_board_comments", { ...board, p_before: before ?? null, p_limit: COMMENTS_PAGE_SIZE }),
    addComment: (body, objectId) =>
      rpc<BoardComment>("add_comment", { ...board, p_body: body, p_object_id: objectId ?? null }),
    updateComment: (id, body) => rpc<BoardComment>("update_comment", { p_comment_id: id, p_body: body }),
    deleteComment: async (id) => {
      await rpc("delete_comment", { p_comment_id: id });
    },
    loadActivity: (before) =>
      rpc<ActivityItem[]>("get_board_activity", { ...board, p_before: before ?? null, p_limit: ACTIVITY_PAGE_SIZE }),
    renameBoard: (title) => rpc<BoardSummary>("update_board", { ...board, p_title: title, p_description: null }),
    recordExport: async (scope) => {
      await rpc("record_board_export", { ...board, p_scope: scope });
    },

    getSharing: () => rpc<SharingSettings>("get_sharing", board),
    updateSharing: (changes) =>
      rpc<SharingSettings>("update_sharing", {
        ...board,
        p_access_mode: changes.access_mode ?? null,
        p_code_enabled: changes.code_enabled ?? null,
        p_share_link_enabled: changes.share_link_enabled ?? null,
        p_viewers_can_comment: changes.viewers_can_comment ?? null,
      }),
    regenerateCode: () => rpc<string>("regenerate_collaboration_code", board),
    regenerateShareLink: () => rpc<string>("regenerate_share_link", board),
    createInvitation: (email, role) =>
      rpc<{ id: string; token: string; expires_at: string }>("create_invitation", {
        ...board,
        p_email: email,
        p_role: role,
      }),
    listInvitations: () => rpc<Invitation[]>("list_board_invitations", board),
    resendInvitation: (id) =>
      rpc<{ id: string; token: string; expires_at: string }>("resend_invitation", { p_invitation_id: id }),
    revokeInvitation: async (id) => {
      await rpc("revoke_invitation", { p_invitation_id: id });
    },
    listJoinRequests: () => rpc<JoinRequest[]>("list_join_requests", board),
    decideJoinRequest: async (id, approve, role) => {
      await rpc("decide_join_request", { p_request_id: id, p_approve: approve, p_role: role ?? "VIEWER" });
    },
    changeMemberRole: async (memberId, role) => {
      await rpc("change_member_role", { ...board, p_user_id: memberId, p_role: role });
    },
    removeMember: async (memberId) => {
      await rpc("remove_member", { ...board, p_user_id: memberId });
    },
    transferOwnership: async (memberId) => {
      await rpc("transfer_ownership", { ...board, p_new_owner_id: memberId });
    },
  };
}
