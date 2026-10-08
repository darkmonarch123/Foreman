"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client. Uses only the anon/publishable key; every request
 * it makes is authorised by the signed-in user's JWT and Row Level Security.
 * The session lives in cookies managed by @supabase/ssr, not in localStorage.
 */
export function getBrowserClient(): SupabaseClient {
  if (client) return client;
  const env = getPublicEnv();
  if (!env) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  client = createBrowserClient(env.supabaseUrl, env.supabaseKey);
  return client;
}
