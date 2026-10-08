import { describe, expect, it } from "vitest";
import { AVATAR_SEED_PATTERN, generateAvatarSvg, isAvatarStyle } from "@/lib/avatar/generate";
import { CONSENT_VERSION, mayLoadAnalytics, parseConsent } from "@/lib/consent";
import { getPublicEnv, getSiteUrl } from "@/lib/env";
import { PLANS, formatCapacity, planAllows } from "@/lib/templates/plans";

describe("avatar generation", () => {
  it("is deterministic for a seed and style", () => {
    expect(generateAvatarSvg("female", "abcdef1234567890")).toBe(generateAvatarSvg("female", "abcdef1234567890"));
  });

  it("differs by seed and by the selected initial preference", () => {
    const base = generateAvatarSvg("female", "abcdef1234567890");
    expect(generateAvatarSvg("female", "zzzzzz0000000000")).not.toBe(base);
    expect(generateAvatarSvg("male", "abcdef1234567890")).not.toBe(base);
  });

  it("produces a self-contained SVG with no scripts or external references", () => {
    for (const style of ["male", "female"] as const) {
      for (const seed of ["aaaaaaaa", "seed0000000000000000000000000001", "x1y2z3w4"]) {
        const svg = generateAvatarSvg(style, seed);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/<script|href=|url\(|onload|foreignObject|<image/i);
      }
    }
  });

  it("only accepts opaque seeds, so nothing personal can be put in an avatar URL", () => {
    expect(AVATAR_SEED_PATTERN.test("abcdef1234567890")).toBe(true);
    expect(AVATAR_SEED_PATTERN.test("someone@example.com")).toBe(false);
    expect(AVATAR_SEED_PATTERN.test("../../etc")).toBe(false);
    expect(AVATAR_SEED_PATTERN.test("short")).toBe(false);
    expect(isAvatarStyle("male")).toBe(true);
    expect(isAvatarStyle("robot")).toBe(false);
  });
});

describe("cookie consent", () => {
  const stored = (value: Record<string, unknown>) => JSON.stringify(value);

  it("requires an explicit, current-version choice before anything optional may load", () => {
    expect(mayLoadAnalytics(null)).toBe(false);
    expect(
      mayLoadAnalytics(
        parseConsent(
          stored({ version: CONSENT_VERSION, analytics: false, preferences: true, decidedAt: "2026-10-08" }),
        ),
      ),
    ).toBe(false);
    expect(
      mayLoadAnalytics(
        parseConsent(
          stored({ version: CONSENT_VERSION, analytics: true, preferences: false, decidedAt: "2026-10-08" }),
        ),
      ),
    ).toBe(true);
  });

  it("treats a choice made under an older policy version as no choice", () => {
    expect(
      parseConsent(stored({ version: "2020-01", analytics: true, preferences: true, decidedAt: "2020-01-01" })),
    ).toBeNull();
  });

  it("ignores malformed stored values", () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("{broken")).toBeNull();
    expect(
      parseConsent(stored({ version: CONSENT_VERSION, analytics: "yes", preferences: true, decidedAt: "x" })),
    ).toBeNull();
    expect(parseConsent("true")).toBeNull();
  });
});

describe("plans", () => {
  it("states template numbers as capacity limits", () => {
    expect(PLANS.FREE.templateCapacity).toBe(1_000);
    expect(PLANS.PLUS.templateCapacity).toBe(10_000);
    expect(PLANS.PRO.templateCapacity).toBe(100_000);
    expect(formatCapacity(100_000)).toBe("100,000");
  });

  it("does not offer plans that cannot be purchased", () => {
    expect(PLANS.FREE.purchasable).toBe(true);
    expect(PLANS.PLUS.purchasable).toBe(false);
    expect(PLANS.PRO.purchasable).toBe(false);
  });

  it("checks entitlement by plan rank", () => {
    expect(planAllows("FREE", "FREE")).toBe(true);
    expect(planAllows("FREE", "PLUS")).toBe(false);
    expect(planAllows("PRO", "PLUS")).toBe(true);
  });
});

describe("environment", () => {
  it("is unconfigured without both public values, and rejects a non-HTTPS project URL", () => {
    const original = { ...process.env };
    try {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      expect(getPublicEnv()).toBeNull();
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
      expect(getPublicEnv()).toBeNull();
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
      expect(getPublicEnv()).toEqual({ supabaseUrl: "https://project.supabase.co", supabaseKey: "anon" });
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://project.example.com";
      expect(getPublicEnv()).toBeNull();
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";
      expect(getPublicEnv()).toBeNull();
      process.env.NEXT_PUBLIC_SITE_URL = "https://foreman.onrender.com/";
      expect(getSiteUrl()).toBe("https://foreman.onrender.com");
    } finally {
      process.env = original;
    }
  });
});
