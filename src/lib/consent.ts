/**
 * Cookie consent.
 *
 * Foreman sets only essential cookies today: the Supabase session cookie and
 * a short-lived password-recovery marker. Those do not need consent. There is
 * no analytics or advertising code in the product.
 *
 * The consent record exists so that IF optional cookies are ever added, they
 * are gated from day one: nothing optional may load unless `analytics` or
 * `preferences` is true for the current CONSENT_VERSION.
 */
export const CONSENT_VERSION = "2026-10";
export const CONSENT_STORAGE_KEY = "foreman:cookie-consent";

export interface ConsentChoice {
  version: string;
  analytics: boolean;
  preferences: boolean;
  decidedAt: string;
}

export function parseConsent(raw: string | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== CONSENT_VERSION ||
      typeof candidate.analytics !== "boolean" ||
      typeof candidate.preferences !== "boolean" ||
      typeof candidate.decidedAt !== "string"
    ) {
      return null;
    }
    return {
      version: CONSENT_VERSION,
      analytics: candidate.analytics,
      preferences: candidate.preferences,
      decidedAt: candidate.decidedAt,
    };
  } catch {
    return null;
  }
}

/** The single gate any future optional script must pass. */
export function mayLoadAnalytics(choice: ConsentChoice | null): boolean {
  return choice?.version === CONSENT_VERSION && choice.analytics === true;
}
