import { z } from "zod";

/**
 * Performance events: how long an action took from the person's point of view.
 *
 * An event carries only these fields. There is deliberately no field for note
 * text, comment text, drawing data, guidance text or board contents, and the
 * schema is strict, so nothing else can be attached.
 */
export const PERF_ACTIONS = [
  "board_open",
  "canvas_first_interaction",
  "object_create",
  "object_move",
  "comment_create",
  "assistant_run",
  "proposal_accept",
  "template_search",
  "dashboard_load",
] as const;
export type PerfAction = (typeof PERF_ACTIONS)[number];

export const PERF_OUTCOMES = ["ok", "error", "stale", "rejected", "cancelled"] as const;
export type PerfOutcome = (typeof PERF_OUTCOMES)[number];

/** Where the timing was taken: the server (request work) or the browser (action to visible feedback). */
export const PERF_SOURCES = ["server", "client"] as const;

export interface PerfEvent {
  action: PerfAction;
  durationMs: number;
  outcome: PerfOutcome;
  /** A normalised error code (e.g. RATE_LIMITED), never a message. */
  code?: string;
  boardId?: string;
  userId?: string;
  source: (typeof PERF_SOURCES)[number];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a browser may send. The user id is never accepted from the client; the server adds it from the session. */
export const clientPerfEventSchema = z
  .object({
    action: z.enum(PERF_ACTIONS),
    durationMs: z.number().finite().min(0).max(600_000),
    outcome: z.enum(PERF_OUTCOMES),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
      .optional(),
    boardId: z.string().regex(UUID).optional(),
  })
  .strict();

/** A batch is checked as a whole for shape, then each event on its own, so one bad event drops only itself. */
export const clientPerfBatchSchema = z.object({ events: z.array(z.unknown()).min(1).max(20) }).strict();

export function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
