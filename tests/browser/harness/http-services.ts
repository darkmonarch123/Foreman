import type { BoardServices, RealtimeHandlers } from "@/lib/board/services";
import {
  parseActivityEvent,
  parseCommentEvent,
  parseCursor,
  parseServerOperation,
} from "@/lib/board/supabase-services";
import { AppError, type ErrorCode } from "@/lib/errors";

/**
 * BoardServices over the test backend (tests/browser/fake-backend.ts).
 * Incoming events go through the same validators the Supabase implementation
 * uses, so malformed payloads are rejected identically.
 */
export function createHttpBoardServices(baseUrl: string, userKey: string): BoardServices {
  async function rpc<T>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/rpc/${fn}?user=${encodeURIComponent(userKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AppError("NETWORK");
    }
    const data = (await response.json().catch(() => null)) as { code?: ErrorCode } | T | null;
    if (!response.ok) {
      throw new AppError(((data as { code?: ErrorCode } | null)?.code ?? "UNKNOWN") as ErrorCode);
    }
    return data as T;
  }

  let lastCursor = 0;

  return {
    transport: {
      submit: (operation) => rpc("submit", { operation }),
      fetchAfter: (sequence) => rpc("fetchAfter", { sequence }),
    },
    realtime: {
      connect(handlers: RealtimeHandlers) {
        const source = new EventSource(`${baseUrl}/events?user=${encodeURIComponent(userKey)}`);
        source.addEventListener("ready", () => handlers.onStatus(true));
        source.addEventListener("error", () => handlers.onStatus(false));
        source.addEventListener("operation", (event) => {
          const operation = parseServerOperation(JSON.parse((event as MessageEvent).data));
          if (operation) handlers.onOperation(operation);
        });
        source.addEventListener("comment", (event) => {
          const parsed = parseCommentEvent(JSON.parse((event as MessageEvent).data));
          if (parsed) handlers.onComment(parsed);
        });
        source.addEventListener("activity", (event) => {
          const parsed = parseActivityEvent(JSON.parse((event as MessageEvent).data));
          if (parsed) handlers.onActivity(parsed);
        });
        source.addEventListener("presence", (event) => {
          const ids = JSON.parse((event as MessageEvent).data) as unknown;
          if (Array.isArray(ids)) handlers.onPresence(ids.filter((id): id is string => typeof id === "string"));
        });
        source.addEventListener("cursor", (event) => {
          const cursor = parseCursor(JSON.parse((event as MessageEvent).data));
          if (cursor) handlers.onCursor(cursor);
        });
        return () => source.close();
      },
      sendCursor(x, y) {
        const now = Date.now();
        if (now - lastCursor < 60) return;
        lastCursor = now;
        void fetch(`${baseUrl}/cursor?user=${encodeURIComponent(userKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x, y }),
        }).catch(() => undefined);
      },
    },
    getBoard: () => rpc("getBoard"),
    loadMembers: () => rpc("loadMembers"),
    loadComments: () => rpc("loadComments"),
    addComment: (body, objectId) => rpc("addComment", { body, objectId: objectId ?? null }),
    updateComment: (id, body) => rpc("updateComment", { id, body }),
    deleteComment: async (id) => {
      await rpc("deleteComment", { id });
    },
    loadActivity: () => rpc("loadActivity"),
    renameBoard: (title) => rpc("renameBoard", { title }),
    recordExport: async (scope) => {
      await rpc("recordExport", { scope });
    },
    getSharing: () => rpc("getSharing"),
    updateSharing: (changes) => rpc("updateSharing", { changes }),
    regenerateCode: () => rpc("regenerateCode"),
    regenerateShareLink: () => rpc("regenerateShareLink"),
    createInvitation: (email, role) => rpc("createInvitation", { email, role }),
    listInvitations: () => rpc("listInvitations"),
    resendInvitation: (id) => rpc("resendInvitation", { id }),
    revokeInvitation: async (id) => {
      await rpc("revokeInvitation", { id });
    },
    listJoinRequests: () => rpc("listJoinRequests"),
    decideJoinRequest: async (id, approve, role) => {
      await rpc("decideJoinRequest", { id, approve, role });
    },
    changeMemberRole: async (userId, role) => {
      await rpc("changeMemberRole", { userId, role });
    },
    removeMember: async (userId) => {
      await rpc("removeMember", { userId });
    },
    transferOwnership: async (userId) => {
      await rpc("transferOwnership", { userId });
    },
  };
}
