import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE } from "@/lib/auth/constants";
import { getPublicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase Auth emails.
 *
 * Supports both link styles:
 *   ?token_hash=...&type=recovery|email|signup   (verified here with verifyOtp)
 *   ?code=...                                    (PKCE code exchanged for a session)
 *
 * The token is consumed on the server and the browser is immediately
 * redirected to a clean URL, so it does not linger in the address bar,
 * history or Referer headers.
 */
const ALLOWED_TYPES = new Set(["recovery", "email", "signup"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const next = safeNextPath(params.get("next"), "/welcome");
  const isRecovery = type === "recovery" || (!type && next === "/reset-password");
  const failure = isRecovery ? "/reset-password?status=invalid" : "/verify-email?status=invalid";

  if (!getPublicEnv()) redirect("/login");

  const supabase = await createClient();
  let userId: string | undefined;

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as "recovery" | "email" | "signup",
      token_hash: tokenHash,
    });
    if (error) redirect(failure);
    userId = data.user?.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect(failure);
    userId = data.user?.id;
  } else {
    redirect(failure);
  }

  if (!userId) redirect(failure);

  if (isRecovery) {
    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_COOKIE, userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE,
    });
    redirect("/reset-password");
  }

  redirect(`/verify-email?status=verified&next=${encodeURIComponent(next)}`);
}
