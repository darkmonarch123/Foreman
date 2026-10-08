import type { BoardTransport } from "@/lib/board/engine";
import { applyLocalOperation } from "@/lib/board/reducer";
import type {
  BoardState,
  CanvasObject,
  PendingOperation,
  ServerOperation,
  SubmitResult,
  UpdatePayload,
} from "@/lib/board/types";
import { AppError, type ErrorCode } from "@/lib/errors";

/**
 * In-memory stand-in for `submit_operation` / `get_operations_after`, used to
 * test the client engine. It follows the same rules as the database function
 * (sequencing, deduplication, deletion wins, text-version check); the database
 * function itself is tested separately in tests/db/canvas.test.ts.
 */
export class FakeBoardServer {
  objects = new Map<string, CanvasObject>();
  log: ServerOperation[] = [];
  seen = new Map<string, number>();
  submitCalls: string[] = [];
  /** When set, the next calls fail with this error code. */
  failWith: ErrorCode | null = null;
  failCount = 0;
  private subscribers = new Set<(operation: ServerOperation) => void>();
  /** Hold broadcasts back to simulate a slow or dropped realtime channel. */
  deliverBroadcasts = true;

  get lastSequence(): number {
    return this.log.length;
  }

  state(): BoardState {
    return {
      board: {
        id: "board",
        title: "Test",
        description: "",
        access_mode: "PRIVATE",
        viewers_can_comment: false,
        owner_id: "owner",
        last_sequence: this.lastSequence,
        created_at: "",
        updated_at: "",
        role: "OWNER",
      },
      snapshot: { sequence: this.lastSequence, objects: [...this.objects.values()].filter((o) => !o.deleted) },
      operations: [],
      last_sequence: this.lastSequence,
    };
  }

  subscribe(listener: (operation: ServerOperation) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  failNext(code: ErrorCode, times = 1): void {
    this.failWith = code;
    this.failCount = times;
  }

  private maybeFail(): void {
    if (this.failWith && this.failCount > 0) {
      this.failCount -= 1;
      const code = this.failWith;
      if (this.failCount === 0) this.failWith = null;
      throw new AppError(code);
    }
  }

  apply(actorId: string, operation: PendingOperation): SubmitResult {
    const existingSequence = this.seen.get(operation.operation_id);
    const current = this.objects.get(operation.object_id);
    if (existingSequence !== undefined) {
      return { status: "duplicate", sequence: existingSequence, object: current!, last_sequence: this.lastSequence };
    }
    const conflict = (code: string): SubmitResult => ({
      status: "conflict",
      code,
      object: current!,
      last_sequence: this.lastSequence,
    });

    if (operation.type === "OBJECT_CREATED") {
      if (current) return conflict("OBJECT_EXISTS");
    } else {
      if (!current) throw new AppError("OBJECT_NOT_FOUND");
      if (operation.type === "OBJECT_RESTORED") {
        if (!current.deleted) return conflict("OBJECT_NOT_DELETED");
      } else if (current.deleted) {
        return conflict("OBJECT_DELETED");
      } else if (
        operation.type === "OBJECT_UPDATED" &&
        (operation.payload as UpdatePayload).props?.text !== undefined &&
        operation.expected_version !== current.version
      ) {
        return conflict("TEXT_CONFLICT");
      }
    }

    const next = applyLocalOperation(current, operation, actorId)!;
    const sequence = this.lastSequence + 1;
    // Like the database function: a new object goes on top of everything already there.
    const top = Math.max(0, ...[...this.objects.values()].map((object) => object.z_index));
    const stored: CanvasObject = {
      ...next,
      z_index: next.z_index === Number.MAX_SAFE_INTEGER ? top + 1 : next.z_index,
    };
    this.objects.set(stored.id, stored);
    this.seen.set(operation.operation_id, sequence);
    const serverOperation: ServerOperation = {
      operation_id: operation.operation_id,
      sequence,
      type: operation.type,
      object_id: operation.object_id,
      actor_id: actorId,
      object: stored,
      server_timestamp: new Date(0).toISOString(),
    };
    this.log.push(serverOperation);
    if (this.deliverBroadcasts) {
      for (const subscriber of this.subscribers) subscriber(serverOperation);
    }
    return { status: "accepted", sequence, object: stored, last_sequence: sequence };
  }

  transportFor(actorId: string): BoardTransport {
    return {
      submit: async (operation) => {
        this.submitCalls.push(operation.operation_id);
        await Promise.resolve();
        this.maybeFail();
        return this.apply(actorId, operation);
      },
      fetchAfter: async (sequence) => {
        await Promise.resolve();
        this.maybeFail();
        return {
          operations: this.log.filter((operation) => operation.sequence > sequence),
          last_sequence: this.lastSequence,
        };
      },
    };
  }
}
