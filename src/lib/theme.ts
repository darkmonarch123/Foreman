/**
 * Light / Dark / System appearance.
 *
 * The choice is kept in this browser (localStorage) and, for signed-in people, on their
 * account, so it follows them to other devices. The resolved theme ("light" or "dark")
 * is written to `<html data-theme>` before first paint by THEME_INIT_SCRIPT, so there is
 * no flash of the wrong theme. "System" tracks the operating system live.
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "foreman:theme";
export const THEME_CHANGE_EVENT = "foreman:theme-changed";

export const THEME_LABELS: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

/** Runs in <head> before the page paints. Kept tiny and dependency-free on purpose. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.dataset.themePreference=p}catch(e){}})();`;

export function readStoredPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Applies a preference to the page and remembers it in this browser. */
export function applyThemePreference(preference: ThemePreference): void {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(preference, systemDark);
  root.dataset.themePreference = preference;
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the theme still applies for this page.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
