/** Harness stand-ins for the auth Server Actions. */
export async function logoutAction(): Promise<void> {
  (window as unknown as { __loggedOut?: boolean }).__loggedOut = true;
}
export async function logoutEverywhereAction(): Promise<void> {}
export async function recordCookieConsentAction() {
  return { ok: true as const, data: undefined };
}
export async function setThemePreferenceAction(input: { theme: string }) {
  (window as unknown as { __themeSaved?: string }).__themeSaved = input.theme;
  return { ok: true as const, data: { theme: input.theme } };
}
