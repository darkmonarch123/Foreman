"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { setThemePreferenceAction } from "@/lib/auth/actions";
import { cn } from "@/lib/cn";
import { THEME_LABELS, applyThemePreference, readStoredPreference, type ThemePreference } from "@/lib/theme";
import { useThemePreference } from "./theme-controller";

export const THEME_ICONS: Record<ThemePreference, ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  system: <Monitor />,
};

/**
 * Changes the appearance now, in this browser, and saves it on the account so it follows
 * the person to other devices. Saving is best effort: the change has already applied here.
 */
export function chooseTheme(preference: ThemePreference, options: { saveToAccount?: boolean } = {}): void {
  applyThemePreference(preference);
  if (options.saveToAccount !== false) void setThemePreferenceAction({ theme: preference }).catch(() => undefined);
}

/**
 * When someone signs in on a browser, their account's appearance wins over whatever this
 * browser remembered from before. After that, both are updated together by chooseTheme.
 */
export function useAccountTheme(accountPreference: ThemePreference | undefined): void {
  useEffect(() => {
    if (accountPreference && accountPreference !== readStoredPreference()) applyThemePreference(accountPreference);
  }, [accountPreference]);
}

/** Light / Dark / System as a labelled radio group with full-size touch targets. */
export function ThemeChoice({ className, saveToAccount = true }: { className?: string; saveToAccount?: boolean }) {
  const theme = useThemePreference();
  const order: ThemePreference[] = ["light", "dark", "system"];
  return (
    <fieldset className={className}>
      <legend className="text-sm font-medium">Theme</legend>
      <div className="mt-2 grid grid-cols-3 gap-3 sm:max-w-md">
        {order.map((option) => {
          const active = theme === option;
          return (
            <label
              key={option}
              className={cn(
                "flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border px-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus [&_svg]:size-4",
                active
                  ? "border-accent bg-accent-soft font-medium text-accent-ink"
                  : "border-line bg-surface text-ink hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option}
                checked={active}
                onChange={() => chooseTheme(option, { saveToAccount })}
                className="sr-only"
              />
              {THEME_ICONS[option]}
              {THEME_LABELS[option]}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] text-muted">
        System follows your device. Your choice is saved to your account and this browser.
      </p>
    </fieldset>
  );
}
