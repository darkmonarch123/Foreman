import "server-only";

import { toAppError } from "@/lib/errors";

/**
 * Operational telemetry for the Assistant, as one JSON line per event.
 *
 * Only a fixed set of non-content fields can be logged: the scope, a
 * correlation id, the action, how many findings there were, the outcome and
 * how long it took. There is deliberately no field for note text, comment
 * text, drawing data, guidance, e-mail addresses or board titles, so none can
 * be passed in.
 */
export interface AssistantLogFields {
  requestId: string;
  action?: string;
  contextKind?: "board" | "object";
  findings?: number;
  outcome: "ok" | "error" | "disabled" | "denied" | "stale" | "applied" | "rejected" | "failed";
  /** Normalised error code, never the upstream message. */
  code?: string;
  durationMs?: number;
}

export function logAssistant(scope: string, fields: AssistantLogFields): void {
  const line = JSON.stringify({
    level: fields.outcome === "error" ? "error" : "info",
    scope,
    ...fields,
    at: new Date().toISOString(),
  });
  if (fields.outcome === "error") console.error(line);
  else console.info(line);
}

export function errorCode(error: unknown): string {
  return toAppError(error).code;
}
