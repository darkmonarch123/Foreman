/** Route classification shared by the proxy and the server-side guards. */

const PROTECTED_PREFIXES = ["/welcome", "/dashboard", "/templates", "/boards", "/join", "/settings", "/invitations"];
const GUEST_ONLY = ["/login", "/register", "/forgot-password"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matches(pathname, prefix));
}

export function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY.some((prefix) => matches(pathname, prefix));
}

/**
 * Accepts only same-origin relative paths for post-login redirects, so a
 * crafted `?next=` can never send someone to another site.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://foreman.invalid");
    if (url.origin !== "http://foreman.invalid") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export function loginPathFor(pathname: string, search = ""): string {
  const next = safeNextPath(`${pathname}${search}`, "");
  return next && next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
