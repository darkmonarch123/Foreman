/**
 * The `assistant_enabled` feature flag.
 *
 * Read from the ASSISTANT_ENABLED environment variable on the server only.
 *   "true" or "1"    on
 *   "false" or "0"   off
 *   unset            on in development and tests, OFF in production
 *
 * The flag is checked in every Server Action as well as in the page, so
 * turning it off removes the feature even for a browser that still has the
 * old code loaded.
 */
export function isAssistantEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.ASSISTANT_ENABLED?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return env.NODE_ENV !== "production";
}
