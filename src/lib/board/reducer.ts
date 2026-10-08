import type {
  BoardState,
  CanvasObject,
  CreatePayload,
  MovePayload,
  PendingOperation,
  ServerOperation,
  UpdatePayload,
} from "./types";

/**
 * Pure state transitions for the canvas. Shared by initial load, realtime
 * delivery, reconnect recovery and optimistic rendering, so every path
 * produces the same board.
 */

export type ObjectMap = ReadonlyMap<string, CanvasObject>;

export interface ServerDocument {
  objects: ObjectMap;
  lastSequence: number;
}

/**
 * Stores a server object state unless we already hold a newer version. The
 * version check makes application idempotent and safe against out-of-order
 * delivery (an acknowledgement racing a broadcast, or a recovery batch that
 * overlaps what was already applied).
 */
export function upsertObject(objects: ObjectMap, incoming: CanvasObject): ObjectMap {
  const existing = objects.get(incoming.id);
  if (existing && existing.version > incoming.version) return objects;
  const next = new Map(objects);
  next.set(incoming.id, incoming);
  return next;
}

/** Step 1 and 2 of loading a board: latest snapshot, then the operations accepted after it. */
export function buildDocument(state: Pick<BoardState, "snapshot" | "operations" | "last_sequence">): ServerDocument {
  let objects: ObjectMap = new Map(state.snapshot.objects.map((object) => [object.id, object]));
  let lastSequence = state.snapshot.sequence;
  const ordered = [...state.operations].sort((a, b) => a.sequence - b.sequence);
  for (const operation of ordered) {
    objects = upsertObject(objects, operation.object);
    lastSequence = Math.max(lastSequence, operation.sequence);
  }
  return { objects, lastSequence: Math.max(lastSequence, state.last_sequence) };
}

export type ApplyResult =
  | { kind: "applied"; document: ServerDocument }
  | { kind: "stale"; document: ServerDocument }
  | { kind: "gap"; document: ServerDocument };

/**
 * Applies one sequenced operation.
 *  - the next expected sequence is applied
 *  - an older sequence is ignored (already reflected)
 *  - a later sequence means something was missed: the caller must recover
 */
export function applyServerOperation(document: ServerDocument, operation: ServerOperation): ApplyResult {
  if (operation.sequence <= document.lastSequence) {
    return { kind: "stale", document };
  }
  if (operation.sequence > document.lastSequence + 1) {
    return { kind: "gap", document };
  }
  return {
    kind: "applied",
    document: { objects: upsertObject(document.objects, operation.object), lastSequence: operation.sequence },
  };
}

/** Applies a batch (from recovery) in sequence order, skipping what is already known. */
export function applyServerOperations(document: ServerDocument, operations: ServerOperation[]): ServerDocument {
  let current = document;
  for (const operation of [...operations].sort((a, b) => a.sequence - b.sequence)) {
    if (operation.sequence <= current.lastSequence) continue;
    current = {
      objects: upsertObject(current.objects, operation.object),
      lastSequence: operation.sequence,
    };
  }
  return current;
}

/** What one local operation does to an object, without the server. */
export function applyLocalOperation(
  object: CanvasObject | undefined,
  operation: PendingOperation,
  actorId: string,
): CanvasObject | undefined {
  const now = operation.client_timestamp;
  switch (operation.type) {
    case "OBJECT_CREATED": {
      if (object) return object;
      const payload = operation.payload as CreatePayload;
      return {
        id: operation.object_id,
        type: payload.type,
        x: payload.x,
        y: payload.y,
        width: payload.width,
        height: payload.height,
        rotation: payload.rotation ?? 0,
        z_index: payload.z_index ?? Number.MAX_SAFE_INTEGER,
        props: { ...payload.props },
        version: 1,
        deleted: false,
        created_by: actorId,
        updated_by: actorId,
        updated_at: now,
      };
    }
    case "OBJECT_MOVED": {
      // Deletion wins: a move never resurrects or shifts a deleted object.
      if (!object || object.deleted) return object;
      const payload = operation.payload as MovePayload;
      return {
        ...object,
        x: payload.x,
        y: payload.y,
        version: object.version + 1,
        updated_by: actorId,
        updated_at: now,
      };
    }
    case "OBJECT_UPDATED": {
      if (!object || object.deleted) return object;
      const payload = operation.payload as UpdatePayload;
      return {
        ...object,
        x: payload.x ?? object.x,
        y: payload.y ?? object.y,
        width: payload.width ?? object.width,
        height: payload.height ?? object.height,
        rotation: payload.rotation ?? object.rotation,
        z_index: payload.z_index ?? object.z_index,
        props: { ...object.props, ...(payload.props ?? {}) },
        version: object.version + 1,
        updated_by: actorId,
        updated_at: now,
      };
    }
    case "OBJECT_DELETED": {
      if (!object || object.deleted) return object;
      return { ...object, deleted: true, version: object.version + 1, updated_by: actorId, updated_at: now };
    }
    case "OBJECT_RESTORED": {
      if (!object || !object.deleted) return object;
      return { ...object, deleted: false, version: object.version + 1, updated_by: actorId, updated_at: now };
    }
  }
}

/**
 * The board as the person should see it: confirmed server state with their
 * unacknowledged operations re-applied on top (optimistic UI). When a remote
 * change arrives, pending operations are simply replayed over the new base.
 */
export function projectView(objects: ObjectMap, pending: readonly PendingOperation[], actorId: string): ObjectMap {
  if (pending.length === 0) return objects;
  const view = new Map(objects);
  for (const operation of pending) {
    const next = applyLocalOperation(view.get(operation.object_id), operation, actorId);
    if (next) view.set(operation.object_id, next);
  }
  return view;
}

/** Visible objects in paint order. */
export function visibleObjects(objects: ObjectMap): CanvasObject[] {
  return [...objects.values()]
    .filter((object) => !object.deleted)
    .sort((a, b) => a.z_index - b.z_index || a.id.localeCompare(b.id));
}
