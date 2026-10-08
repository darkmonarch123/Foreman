/** Harness stand-ins for the auth Server Actions. */
export async function logoutAction(): Promise<void> {
  (window as unknown as { __loggedOut?: boolean }).__loggedOut = true;
}
export async function logoutEverywhereAction(): Promise<void> {}
export async function recordCookieConsentAction() {
  return { ok: true as const, data: undefined };
}
