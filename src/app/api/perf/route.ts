import { clientPerfBatchSchema, clientPerfEventSchema } from "@/lib/perf/events";
import { logPerf } from "@/lib/perf/server";
import { getSessionUserId } from "@/lib/auth/session";

/**
 * Receives client-side timings from the signed-in person's browser.
 *
 * Only the strict schema in perf/events is accepted (action, duration, outcome,
 * error code, board id). The user id comes from the session, never the body.
 * Anything malformed, oversized or anonymous is dropped without detail.
 */
const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  const noContent = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return noContent;
  let parsed;
  try {
    parsed = clientPerfBatchSchema.safeParse(JSON.parse(raw));
  } catch {
    return noContent;
  }
  if (!parsed.success) return noContent;
  const userId = await getSessionUserId();
  if (!userId) return noContent;
  for (const candidate of parsed.data.events) {
    const event = clientPerfEventSchema.safeParse(candidate);
    if (event.success) logPerf({ ...event.data, source: "client", userId });
  }
  return noContent;
}
