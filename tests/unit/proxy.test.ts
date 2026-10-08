import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[]) => void } }) => ({
      auth: {
        getClaims: async () => {
          const result = await getClaims();
          // A refreshed session writes new cookies through the adapter.
          if (result?.refreshed) {
            options.cookies.setAll([
              { name: "sb-test-auth-token", value: "refreshed", options: { path: "/", httpOnly: true } },
            ]);
          }
          return result;
        },
      },
    }),
  ),
}));

async function run(path: string) {
  const { updateSession } = await import("@/lib/supabase/proxy");
  return updateSession(new NextRequest(new URL(path, "https://foreman.example")));
}

const signedIn = { data: { claims: { sub: "11111111-1111-4111-8111-111111111111" } }, error: null };
const signedOut = { data: null, error: null };

describe("proxy route protection", () => {
  beforeEach(() => {
    vi.resetModules();
    getClaims.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects unauthenticated requests for protected routes to login, remembering the destination", async () => {
    getClaims.mockResolvedValue(signedOut);
    for (const [path, next] of [
      ["/dashboard", null],
      ["/boards/abc", "/boards/abc"],
      ["/boards/abc/settings?tab=sharing", "/boards/abc/settings?tab=sharing"],
      ["/settings", "/settings"],
      ["/templates", "/templates"],
      ["/join?code=F-1WE-23XX", "/join?code=F-1WE-23XX"],
    ] as const) {
      const response = await run(path);
      expect(response.status, path).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(next);
    }
  });

  it("lets unauthenticated visitors reach public pages", async () => {
    getClaims.mockResolvedValue(signedOut);
    for (const path of ["/", "/login", "/register", "/privacy", "/verify-email", "/reset-password"]) {
      const response = await run(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("lets authenticated users through and marks their pages as uncacheable", async () => {
    getClaims.mockResolvedValue(signedIn);
    const response = await run("/dashboard");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sends authenticated users away from the login and register pages", async () => {
    getClaims.mockResolvedValue(signedIn);
    for (const path of ["/login", "/register", "/forgot-password"]) {
      const response = await run(path);
      expect(response.status, path).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
    }
  });

  it("passes refreshed session cookies through, including on redirects", async () => {
    getClaims.mockResolvedValue({ ...signedIn, refreshed: true });
    const ok = await run("/dashboard");
    expect(ok.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    const redirected = await run("/login");
    expect(redirected.status).toBe(307);
    expect(redirected.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("fails closed when the auth service cannot be reached", async () => {
    getClaims.mockRejectedValue(new Error("network down"));
    expect((await run("/dashboard")).status).toBe(307);
    expect((await run("/")).status).toBe(200);
  });

  it("treats an invalid token as signed out", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    const response = await run("/boards/abc");
    expect(response.status).toBe(307);
  });

  it("keeps protected routes closed when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const response = await run("/dashboard");
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect((await run("/")).status).toBe(200);
    expect(getClaims).not.toHaveBeenCalled();
  });
});
