import { connection } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

/** Liveness probe for Render. Reports configuration state, never secrets. example */
export async function GET() {
  await connection();
  return Response.json(
    { status: "ok", supabaseConfigured: isSupabaseConfigured(), time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
