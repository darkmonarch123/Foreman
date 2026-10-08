/**
 * Environment access.
 *
 * NEXT_PUBLIC_* values are inlined into the browser bundle at build time and
 * must only ever hold values that are safe to publish (the project URL and
 * the anon/publishable key). Server-only secrets are read in `server-env.ts`,
 * which cannot be imported from client code.
 */

export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

export function getPublicEnv(): PublicEnv | null {
  // Each variable must be referenced literally for Next.js to inline it.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return null;
    }
  } catch {
    return null;
  }
  return { supabaseUrl, supabaseKey };
}

export function isSupabaseConfigured(): boolean {
  return getPublicEnv() !== null;
}

/** The canonical origin of this deployment, without a trailing slash. */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}
