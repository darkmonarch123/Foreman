import "server-only";

import { toAppError } from "@/lib/errors";

/**
 * Server-side logging.
 *
 * Only a scope, a correlation id and the normalised error code are written.
 * Request bodies, cookies, tokens, passwords, email links and board content
 * are never passed to this function and must not be.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export function logServerError(scope: string, error: unknown, requestId?: string): void {
  const appError = toAppError(error);
  // Unknown failures keep the upstream error code (never the message, which
  // can echo user input) to make them diagnosable.
  const upstream = (error as { code?: unknown } | null)?.code;
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      code: appError.code,
      upstream: typeof upstream === "string" ? upstream : undefined,
      requestId,
      at: new Date().toISOString(),
    }),
  );
}
