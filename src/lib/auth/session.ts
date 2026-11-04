import "server-only";

import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id from the verified session JWT (no database read),
 * deduplicated per request. For lightweight endpoints that only need to know
 * who is asking; pages and actions that need the profile use getCurrentProfile.
 */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  if (!getPublicEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return !error && typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
});
