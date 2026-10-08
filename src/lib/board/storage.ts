import { OPERATION_TYPES, type PendingOperation } from "./types";

/**
 * Durable queue for operations the server has not acknowledged.
 *
 * Only unsent operations are stored here, so that closing the tab or losing
 * the connection does not lose work. The board itself is never cached in the
 * browser: confirmed state always comes from the server.
 */
export interface PendingStore {
  load(): PendingOperation[];
  save(operations: readonly PendingOperation[]): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STORED = 500;

function isPendingOperation(value: unknown): value is PendingOperation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.operation_id === "string" &&
    UUID.test(candidate.operation_id) &&
    typeof candidate.object_id === "string" &&
    UUID.test(candidate.object_id) &&
    typeof candidate.type === "string" &&
    (OPERATION_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null &&
    (candidate.expected_version === null || typeof candidate.expected_version === "number") &&
    typeof candidate.client_timestamp === "string"
  );
}

export function pendingStorageKey(userId: string, boardId: string): string {
  return `foreman:pending:v1:${userId}:${boardId}`;
}

export function createLocalPendingStore(userId: string, boardId: string, storage?: Storage): PendingStore {
  const key = pendingStorageKey(userId, boardId);
  const backing = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  return {
    load() {
      if (!backing) return [];
      try {
        const raw = backing.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Stored data is untrusted input: anything malformed is discarded.
        return parsed.filter(isPendingOperation).slice(0, MAX_STORED);
      } catch {
        return [];
      }
    },
    save(operations) {
      if (!backing) return;
      try {
        if (operations.length === 0) backing.removeItem(key);
        else backing.setItem(key, JSON.stringify(operations.slice(0, MAX_STORED)));
      } catch {
        // Storage full or blocked: the queue still lives in memory for this tab.
      }
    },
  };
}

export function createMemoryPendingStore(initial: PendingOperation[] = []): PendingStore {
  let current = [...initial];
  return {
    load: () => [...current],
    save: (operations) => {
      current = [...operations];
    },
  };
}
