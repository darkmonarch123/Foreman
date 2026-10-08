import { describe, expect, it } from "vitest";
import { isGuestOnlyPath, isProtectedPath, loginPathFor, safeNextPath } from "@/lib/routes";

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeNextPath("/boards/123")).toBe("/boards/123");
    expect(safeNextPath("/dashboard?view=shared")).toBe("/dashboard?view=shared");
  });

  it("rejects anything that could leave the site", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/ok\nLocation: https://evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(value, "/dashboard"), String(value)).toBe("/dashboard");
    }
  });
});

describe("route classification", () => {
  it("protects every signed-in area, including nested paths", () => {
    for (const path of [
      "/dashboard",
      "/welcome",
      "/templates",
      "/boards/new",
      "/boards/abc",
      "/boards/abc/settings",
      "/join",
      "/settings",
      "/invitations/accept",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
  });

  it("leaves public pages open and does not over-match prefixes", () => {
    for (const path of [
      "/",
      "/login",
      "/register",
      "/privacy",
      "/terms",
      "/cookies",
      "/verify-email",
      "/reset-password",
      "/dashboards",
      "/joiner",
      "/api/health",
    ]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  it("marks sign-in pages as guest-only", () => {
    expect(isGuestOnlyPath("/login")).toBe(true);
    expect(isGuestOnlyPath("/register")).toBe(true);
    expect(isGuestOnlyPath("/forgot-password")).toBe(true);
    // A signed-in person may still need these.
    expect(isGuestOnlyPath("/reset-password")).toBe(false);
    expect(isGuestOnlyPath("/verify-email")).toBe(false);
  });

  it("builds a login URL that remembers where the person was going", () => {
    expect(loginPathFor("/boards/abc", "?x=1")).toBe("/login?next=%2Fboards%2Fabc%3Fx%3D1");
    expect(loginPathFor("/dashboard")).toBe("/login");
  });
});
