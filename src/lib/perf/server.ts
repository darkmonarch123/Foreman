import "server-only";

import { toAppError } from "@/lib/errors";
import { roundMs, type PerfAction, type PerfEvent, type PerfOutcome } from "./events";

/**
 * Writes one JSON line per performance event. Only the fields of PerfEvent are
 * written, so no content can be logged through here.
 */
export function logPerf(event: PerfEvent): void {
  console.info(
    JSON.stringify({
      level: "info",
      scope: "perf",
      source: event.source,
      action: event.action,
      durationMs: roundMs(event.durationMs),
      outcome: event.outcome,
      code: event.code,
      boardId: event.boardId,
      userId: event.userId,
      at: new Date().toISOString(),
    }),
  );
}

/**
 * Times server work for an action. The outcome is "ok" unless the work throws, in
 * which case the normalised error code is logged and the error rethrown.
 */
export async function timeServer<T>(
  action: PerfAction,
  context: { boardId?: string; userId?: string },
  work: () => Promise<T>,
  outcomeOf?: (result: T) => PerfOutcome,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await work();
    logPerf({
      action,
      source: "server",
      durationMs: performance.now() - started,
      outcome: outcomeOf ? outcomeOf(result) : "ok",
      ...context,
    });
    return result;
  } catch (error) {
    logPerf({
      action,
      source: "server",
      durationMs: performance.now() - started,
      outcome: "error",
      code: toAppError(error).code,
      ...context,
    });
    throw error;
  }
}
