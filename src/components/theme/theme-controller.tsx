"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_CHANGE_EVENT, readStoredPreference, resolveTheme, type ThemePreference } from "@/lib/theme";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

/** The current preference, kept in step across components, tabs and system changes. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readStoredPreference, () => "system");
}

/**
 * Keeps `<html data-theme>` correct after load: follows the operating system while the
 * preference is "System", and picks up a change made in another tab. Renders nothing.
 */
export function ThemeController() {
  useEffect(() => {
    const sync = () => {
      const preference = readStoredPreference();
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = resolveTheme(preference, systemDark);
      document.documentElement.dataset.themePreference = preference;
    };
    sync();
    return subscribe(sync);
  }, []);
  return null;
}
