import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import { isGuestOnlyPath, isProtectedPath, loginPathFor } from "@/lib/routes";

/**
 * Refreshes the Supabase session cookie on every matched request and applies
 * the first, optimistic layer of route protection.
 *
 * This is not the only check: every protected page and server action calls
 * the data-access layer (`lib/auth/dal.ts`) again, and the database enforces
 * Row Level Security regardless of what the UI allows.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();
  const { pathname, search } = request.nextUrl;

  if (!env) {
    // Without configuration nothing can be authenticated: keep protected
    // routes closed and let public pages render.
    if (isProtectedPath(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() validates the JWT signature (and refreshes an expired session)
  // rather than trusting whatever the cookie says.
  let isAuthenticated = false;
  try {
    const { data } = await supabase.auth.getClaims();
    isAuthenticated = Boolean(data?.claims?.sub);
  } catch {
    // Auth service unreachable: fail closed. Protected routes redirect to
    // login; public pages still render.
    isAuthenticated = false;
  }

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    // Carry over any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  if (!isAuthenticated && isProtectedPath(pathname)) {
    return redirectTo(loginPathFor(pathname, search));
  }
  if (isAuthenticated && isGuestOnlyPath(pathname)) {
    return redirectTo("/dashboard");
  }

  // Authenticated pages must never be stored by shared caches.
  if (isAuthenticated || isProtectedPath(pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}
