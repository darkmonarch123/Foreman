import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured");
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Server Supabase client bound to the current request's cookies.
 *
 * It is created with the anon/publishable key and carries the user's session,
 * so the database sees the real user and applies Row Level Security. The
 * service-role key is never used here.
 */
export async function createClient(): Promise<SupabaseClient> {
  const env = getPublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session cookie on the next request.
        }
      },
    },
  });
}
