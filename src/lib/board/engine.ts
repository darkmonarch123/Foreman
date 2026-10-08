import { ERROR_CATALOG, toAppError, type ErrorCode } from "@/lib/errors";
import { backoffDelay } from "./backoff";
import {
  applyServerOperation,
  applyServerOperations,
  buildDocument,
  projectView,
  upsertObject,
  visibleObjects,
  type ObjectMap,
  type ServerDocument,
} from "./reducer";
import type { PendingStore } from "./storage";
import type {
  BoardState,
  CanvasObject,
  CanvasProps,
  CreatePayload,
  MovePayload,
  OperationPayload,
  OperationType,
  PendingOperation,
  ServerOperation,
  SubmitResult,
  UpdatePayload,
} from "./types";

/**
 * The client half of board synchronisation.
 *
 *   local edit ──► optimistic view ──► durable pending queue ──► submit_operation
 *                                                                    │
 *   realtime broadcast / recovery query ──► confirmed document ◄─────┘ ack
 *
 * The engine owns no network code. It talks to a `BoardTransport`, which the
 * app implements with Supabase and tests implement in memory.
 */

export interface BoardTransport {
  /** Submits one operation. Resolves with the server's verdict; rejects on transport or authorization failure. */
  submit(operation: PendingOperation): Promise<SubmitResult>;
  /** Operations accepted after the given sequence number. */
  fetchAfter(sequence: number): Promise<{ operations: ServerOperation[]; last_sequence: number }>;
}

export type EngineStatus = "saved" | "saving" | "offline" | "reconnecting" | "failed";

export interface EngineNotice {
  kind: "conflict" | "rejected" | "sync-failed" | "undo-blocked";
  code?: string;
  message: string;
}

export interface EngineSnapshot {
  /** Visible objects in paint order, including unacknowledged local edits. */
  objects: CanvasObject[];
  byId: ObjectMap;
  status: EngineStatus;
  pendingCount: number;
  lastSequence: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Set when status is "failed". */
  failure: ErrorCode | null;
}

interface HistoryEntry {
  objectId: string;
  undo: { type: OperationType; payload: OperationPayload };
  redo: { type: OperationType; payload: OperationPayload };
  /** Someone else changed the object afterwards; undoing would silently reverse their work. */
  blocked: boolean;
}

export interface BoardEngineOptions {
  userId: string;
  initial: BoardState;
  transport: BoardTransport;
  store: PendingStore;
  canEdit: boolean;
  onNotice?: (notice: EngineNotice) => void;
  random?: () => number;
  newId?: () => string;
  now?: () => Date;
}

/** Errors that mean "try again later", not "this operation is wrong". */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["NETWORK", "UNKNOWN", "RATE_LIMITED", "NOT_CONFIGURED"]);
/** Errors that mean nothing will succeed until the person does something. */
const BLOCKING: ReadonlySet<ErrorCode> = new Set([
  "UNAUTHENTICATED",
  "BOARD_NOT_FOUND",
  "BOARD_ACCESS_DENIED",
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_INACTIVE",
]);

const CONFLICT_MESSAGES: Record<string, string> = {
  TEXT_CONFLICT:
    "Someone else edited that text first. Their version is shown; make your change again if it still applies.",
  OBJECT_DELETED: "That item was deleted by someone else, so your change wasn't applied.",
  OBJECT_EXISTS: "That item already exists on the board.",
  OBJECT_NOT_DELETED: "That item was already restored.",
};

const MAX_HISTORY = 100;

export class BoardEngine {
  private readonly userId: string;
  private readonly transport: BoardTransport;
  private readonly store: PendingStore;
  private readonly onNotice?: (notice: EngineNotice) => void;
  private readonly random: () => number;
  private readonly newId: () => string;
  private readonly now: () => Date;

  private document: ServerDocument;
  private pending: PendingOperation[];
  private readonly buffered = new Map<number, ServerOperation>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private canEdit: boolean;
  private online = true;
  private realtimeConnected = true;
  private flushing = false;
  private failure: ErrorCode | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private recovering: Promise<void> | null = null;
  private needsRecovery = false;
  private disposed = false;

  private readonly listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;

  constructor(options: BoardEngineOptions) {
    this.userId = options.userId;
    this.transport = options.transport;
    this.store = options.store;
    this.canEdit = options.canEdit;
    this.onNotice = options.onNotice;
    this.random = options.random ?? Math.random;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());

    this.document = buildDocument(options.initial);
    // Operations left over from a previous session are sent again. The server
    // deduplicates on operation_id, so anything that did arrive is not applied twice.
    this.pending = options.canEdit ? options.store.load() : [];
    this.snapshot = this.computeSnapshot();
  }

  // -- subscription (useSyncExternalStore-compatible) ------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  /**
   * Begins sending anything left in the queue. Safe to call again after
   * `dispose()` (React runs effects twice in development).
   */
  start(): void {
    this.disposed = false;
    void this.flush();
  }

  /** Stops timers and network activity. Queued operations stay in the store. */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // -- local edits ----------------------------------------------------------

  create(payload: CreatePayload, objectId: string = this.newId()): string | null {
    const ok = this.dispatch("OBJECT_CREATED", objectId, payload, true);
    return ok ? objectId : null;
  }

  move(objectId: string, position: MovePayload): boolean {
    const current = this.snapshot.byId.get(objectId);
    if (!current || (current.x === position.x && current.y === position.y)) return false;
    return this.dispatch("OBJECT_MOVED", objectId, position, true);
  }

  update(objectId: string, changes: UpdatePayload): boolean {
    return this.dispatch("OBJECT_UPDATED", objectId, changes, true);
  }

  remove(objectId: string): boolean {
    return this.dispatch("OBJECT_DELETED", objectId, {}, true);
  }

  /**
   * Undoes the current user's most recent change by submitting a new,
   * compensating operation. History is never rewritten, and a change is not
   * undone if someone else has touched the object since.
   */
  undo(): boolean {
    return this.stepHistory(this.undoStack, this.redoStack, "undo");
  }

  redo(): boolean {
    return this.stepHistory(this.redoStack, this.undoStack, "redo");
  }

  // -- inputs from the network ------------------------------------------------

  /** An operation delivered by the realtime channel. */
  receive(operation: ServerOperation): void {
    if (this.disposed) return;
    this.ingest(operation);
    this.emit();
  }

  /** Browser online/offline signal. */
  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (online) {
      this.resync();
    } else {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.emit();
  }

  /** Realtime channel state. A dropped channel means operations may have been missed. */
  setRealtimeConnected(connected: boolean): void {
    if (this.realtimeConnected === connected) return;
    this.realtimeConnected = connected;
    if (connected) this.resync();
    this.emit();
  }

  /**
   * Reconnect procedure:
   *   1. fetch operations after the last acknowledged sequence
   *   2. apply what was missed
   *   3. resend pending operation ids (the server deduplicates)
   */
  resync(): void {
    if (this.disposed) return;
    this.needsRecovery = true;
    void this.recover().then(() => this.flush());
  }

  /** Clears a blocking failure and tries again (for example after logging back in). */
  retry(): void {
    this.failure = null;
    this.retryAttempt = 0;
    this.emit();
    this.resync();
  }

  /** Drops unsent work. Only ever called from an explicit, confirmed choice in the UI. */
  discardPending(): void {
    this.pending = [];
    this.undoStack = [];
    this.redoStack = [];
    this.store.save(this.pending);
    this.failure = null;
    this.emit();
  }

  setCanEdit(canEdit: boolean): void {
    this.canEdit = canEdit;
  }

  // -- internals --------------------------------------------------------------

  private dispatch(type: OperationType, objectId: string, payload: OperationPayload, recordHistory: boolean): boolean {
    if (!this.canEdit || this.disposed) return false;
    const before = this.snapshot.byId.get(objectId);

    if (type !== "OBJECT_CREATED" && !before) return false;
    if (type === "OBJECT_CREATED" && before) return false;
    if (before?.deleted && type !== "OBJECT_RESTORED") return false;
    if (type === "OBJECT_RESTORED" && before && !before.deleted) return false;

    const operation: PendingOperation = {
      operation_id: this.newId(),
      type,
      object_id: objectId,
      payload,
      // The version this edit was made against, as the person saw it. Earlier
      // queued edits to the same object are sent first, so by the time this
      // one is submitted the server version matches unless someone else
      // changed the object in between.
      expected_version: before?.version ?? null,
      client_timestamp: this.now().toISOString(),
    };

    if (recordHistory) {
      const entry = inverseOf(type, objectId, payload, before);
      if (entry) {
        this.undoStack.push(entry);
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack = [];
      }
    }

    this.pending.push(operation);
    this.store.save(this.pending);
    this.emit();
    void this.flush();
    return true;
  }

  private stepHistory(from: HistoryEntry[], to: HistoryEntry[], direction: "undo" | "redo"): boolean {
    if (!this.canEdit) return false;
    const entry = from.pop();
    if (!entry) return false;

    if (entry.blocked) {
      this.notify({
        kind: "undo-blocked",
        message:
          direction === "undo"
            ? "That change can't be undone because someone else has edited the item since."
            : "That change can't be redone because someone else has edited the item since.",
      });
      this.emit();
      return false;
    }

    const step = direction === "undo" ? entry.undo : entry.redo;
    const ok = this.dispatch(step.type, entry.objectId, step.payload, false);
    if (ok) to.push(entry);
    this.emit();
    return ok;
  }

  private ingest(operation: ServerOperation): void {
    if (operation.actor_id !== this.userId) {
      this.blockHistory(operation.object_id);
    }
    const result = applyServerOperation(this.document, operation);
    if (result.kind === "applied") {
      this.document = result.document;
      this.drainBuffer();
    } else if (result.kind === "gap") {
      this.buffered.set(operation.sequence, operation);
      this.needsRecovery = true;
      void this.recover();
    }
  }

  private drainBuffer(): void {
    for (;;) {
      const next = this.buffered.get(this.document.lastSequence + 1);
      if (!next) break;
      this.buffered.delete(next.sequence);
      this.document = {
        objects: upsertObject(this.document.objects, next.object),
        lastSequence: next.sequence,
      };
    }
    for (const sequence of this.buffered.keys()) {
      if (sequence <= this.document.lastSequence) this.buffered.delete(sequence);
    }
  }

  private recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    if (!this.needsRecovery || this.disposed) return Promise.resolve();

    this.recovering = (async () => {
      try {
        this.needsRecovery = false;
        // A batch is bounded, so keep going until we have caught up.
        for (let guard = 0; guard < 50; guard += 1) {
          const { operations, last_sequence } = await this.transport.fetchAfter(this.document.lastSequence);
          if (this.disposed) return;
          for (const operation of operations) {
            if (operation.actor_id !== this.userId && operation.sequence > this.document.lastSequence) {
              this.blockHistory(operation.object_id);
            }
          }
          this.document = applyServerOperations(this.document, operations);
          this.drainBuffer();
          if (operations.length === 0 || this.document.lastSequence >= last_sequence) break;
        }
        this.retryAttempt = 0;
      } catch (error) {
        this.needsRecovery = true;
        this.handleTransportError(toAppError(error).code);
      } finally {
        this.recovering = null;
        this.emit();
      }
    })();
    return this.recovering;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.disposed || this.failure || !this.online || this.retryTimer) return;
    this.flushing = true;
    this.emit();
    try {
      while (this.pending.length > 0 && this.online && !this.failure && !this.disposed) {
        const operation = this.pending[0];
        let result: SubmitResult;
        try {
          result = await this.transport.submit(operation);
        } catch (error) {
          const code = toAppError(error).code;
          if (RETRYABLE.has(code) || BLOCKING.has(code)) {
            this.handleTransportError(code);
            return;
          }
          // The server refused this particular operation (validation, missing
          // object, ...). Retrying it cannot help, so it is removed and the
          // person is told. Later operations are still sent.
          this.removePending(operation.operation_id);
          this.dropHistoryFor(operation.object_id);
          this.notify({ kind: "rejected", code, message: toAppError(error).message });
          continue;
        }
        if (this.disposed) return;
        this.retryAttempt = 0;
        this.acknowledge(operation, result);
      }
    } finally {
      this.flushing = false;
      this.emit();
    }
  }

  private acknowledge(operation: PendingOperation, result: SubmitResult): void {
    // The acknowledgement is the only thing that removes an operation from the queue.
    this.removePending(operation.operation_id);
    this.document = { ...this.document, objects: upsertObject(this.document.objects, result.object) };

    if (result.status === "conflict") {
      this.blockHistory(operation.object_id);
      this.notify({
        kind: "conflict",
        code: result.code,
        message: CONFLICT_MESSAGES[result.code] ?? "Your change conflicted with a newer one and wasn't applied.",
      });
      return;
    }

    if (result.sequence === this.document.lastSequence + 1) {
      this.document = { ...this.document, lastSequence: result.sequence };
      this.drainBuffer();
    } else if (result.sequence > this.document.lastSequence + 1) {
      // Someone else's operations were sequenced before ours and have not
      // reached us yet: fetch them rather than guess.
      this.needsRecovery = true;
      void this.recover();
    }
  }

  private handleTransportError(code: ErrorCode): void {
    if (BLOCKING.has(code)) {
      this.failure = code;
      this.notify({ kind: "sync-failed", code, message: ERROR_CATALOG[code].message });
      this.emit();
      return;
    }
    this.scheduleRetry(code === "RATE_LIMITED" ? 5_000 : 0);
  }

  private scheduleRetry(minimumMs: number): void {
    if (this.retryTimer || this.disposed || !this.online) return;
    const delay = Math.max(minimumMs, backoffDelay(this.retryAttempt, { random: this.random })) + 50;
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.recover().then(() => this.flush());
      this.emit();
    }, delay);
    this.emit();
  }

  private removePending(operationId: string): void {
    this.pending = this.pending.filter((operation) => operation.operation_id !== operationId);
    this.store.save(this.pending);
  }

  private blockHistory(objectId: string): void {
    for (const entry of this.undoStack) if (entry.objectId === objectId) entry.blocked = true;
    for (const entry of this.redoStack) if (entry.objectId === objectId) entry.blocked = true;
  }

  private dropHistoryFor(objectId: string): void {
    this.undoStack = this.undoStack.filter((entry) => entry.objectId !== objectId);
    this.redoStack = this.redoStack.filter((entry) => entry.objectId !== objectId);
  }

  private notify(notice: EngineNotice): void {
    this.onNotice?.(notice);
  }

  private computeStatus(): EngineStatus {
    if (this.failure) return "failed";
    if (!this.online) return "offline";
    if (this.retryTimer || !this.realtimeConnected) return "reconnecting";
    return this.pending.length > 0 ? "saving" : "saved";
  }

  private computeSnapshot(): EngineSnapshot {
    const byId = projectView(this.document.objects, this.pending, this.userId);
    return {
      objects: visibleObjects(byId),
      byId,
      status: this.computeStatus(),
      pendingCount: this.pending.length,
      lastSequence: this.document.lastSequence,
      canUndo: this.canEdit && this.undoStack.length > 0,
      canRedo: this.canEdit && this.redoStack.length > 0,
      failure: this.failure,
    };
  }

  private emit(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of this.listeners) listener();
  }
}

/** The compensating operation for a local edit, captured from the state it was made against. */
function inverseOf(
  type: OperationType,
  objectId: string,
  payload: OperationPayload,
  before: CanvasObject | undefined,
): HistoryEntry | null {
  switch (type) {
    case "OBJECT_CREATED":
      return {
        objectId,
        undo: { type: "OBJECT_DELETED", payload: {} },
        redo: { type: "OBJECT_RESTORED", payload: {} },
        blocked: false,
      };
    case "OBJECT_DELETED":
      return {
        objectId,
        undo: { type: "OBJECT_RESTORED", payload: {} },
        redo: { type: "OBJECT_DELETED", payload: {} },
        blocked: false,
      };
    case "OBJECT_RESTORED":
      return {
        objectId,
        undo: { type: "OBJECT_DELETED", payload: {} },
        redo: { type: "OBJECT_RESTORED", payload: {} },
        blocked: false,
      };
    case "OBJECT_MOVED": {
      if (!before) return null;
      return {
        objectId,
        undo: { type: "OBJECT_MOVED", payload: { x: before.x, y: before.y } },
        redo: { type: "OBJECT_MOVED", payload },
        blocked: false,
      };
    }
    case "OBJECT_UPDATED": {
      if (!before) return null;
      const changes = payload as UpdatePayload;
      const previous: UpdatePayload = {};
      for (const key of ["x", "y", "width", "height", "rotation", "z_index"] as const) {
        if (changes[key] !== undefined) previous[key] = before[key];
      }
      if (changes.props) {
        const props: Record<string, unknown> = {};
        for (const key of Object.keys(changes.props) as (keyof CanvasProps)[]) {
          const prior = before.props[key];
          // A property that did not exist before is restored to its neutral value.
          props[key] = prior ?? (key === "text" ? "" : key === "bold" ? false : changes.props[key]);
        }
        previous.props = props as CanvasProps;
      }
      return {
        objectId,
        undo: { type: "OBJECT_UPDATED", payload: previous },
        redo: { type: "OBJECT_UPDATED", payload },
        blocked: false,
      };
    }
  }
}
