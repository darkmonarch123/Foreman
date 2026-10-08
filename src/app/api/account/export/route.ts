import { getCurrentProfile } from "@/lib/auth/dal";
import { apiErrorBody, AppError, toAppError } from "@/lib/errors";
import { getPublicEnv } from "@/lib/env";
import { logServerError, newRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

const PATH = "/api/account/export";

function failure(error: unknown, requestId: string): Response {
  const body = apiErrorBody(error, PATH, { requestId });
  return Response.json(body, { status: body.status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Downloads the signed-in user's data as JSON. The database function decides
 * what is included, using the session's user id; there are no parameters.
 */
export async function GET() {
  const requestId = newRequestId();
  if (!getPublicEnv()) return failure(new AppError("NOT_CONFIGURED"), requestId);

  const profile = await getCurrentProfile();
  if (!profile) return failure(new AppError("UNAUTHENTICATED"), requestId);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    if (toAppError(error).code === "UNKNOWN") logServerError("account.export", error, requestId);
    return failure(error, requestId);
  }

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="foreman-data-${day}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
