import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "./types";

/**
 * Data-access layer for identity.
 *
 * Every protected page, layout, Server Action and Route Handler starts here.
 * The user id comes from the verified session JWT; nothing identity-related
 * is ever read from request parameters or form fields.
 */

const PROFILE_COLUMNS =
  "id, first_name, last_name, username, email, email_verified, avatar_url, avatar_seed, avatar_style, avatar_gender_selection, plan, status, notification_prefs, created_at";

/** The signed-in user's profile, or null. Deduplicated per request. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  // Identity is always a request-time question; never let it be prerendered.
  await connection();
  if (!getPublicEnv()) return null;
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;

  // Row Level Security returns only the caller's own row.
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) {
    logServerError("dal.profile", error);
    return null;
  }
  if (!data) return null;

  const profile = data as Profile;
  if (profile.status !== "ACTIVE") {
    // Accounts pending deletion must not keep a usable session.
    return null;
  }
  return profile;
});

/** For protected pages: redirects to the login page when there is no active user. */
export async function requireProfile(nextPath?: string): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return profile;
}

/** For Server Actions: returns the user or null without redirecting. */
export async function getActionUser(): Promise<Profile | null> {
  return getCurrentProfile();
}
