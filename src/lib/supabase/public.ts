import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * A Supabase client with no session: it reads as the anonymous role.
 *
 * Use it only for data that is the same for everyone and public by policy (the
 * published template catalog), typically inside a "use cache" scope, where
 * request cookies are not available. It can never see private data: Row Level
 * Security limits the anonymous role to published templates.
 */
export function createPublicClient(): SupabaseClient {
  const env = getPublicEnv();
  if (!env) throw new Error("Supabase is not configured");
  return createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
