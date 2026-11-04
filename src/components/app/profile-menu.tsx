"use client";

import { LogOut, Settings, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { THEME_ICONS, chooseTheme, useAccountTheme } from "@/components/theme/theme-choice";
import { useThemePreference } from "@/components/theme/theme-controller";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, type MenuItem } from "@/components/ui/menu";
import { logoutAction, logoutEverywhereAction } from "@/lib/auth/actions";
import type { Profile } from "@/lib/auth/types";
import { cn } from "@/lib/cn";
import { THEME_LABELS } from "@/lib/theme";

export type AccountSummary = Pick<Profile, "first_name" | "last_name" | "username" | "avatar_url"> &
  Partial<Pick<Profile, "email" | "theme_preference">>;

interface ProfileMenuProps {
  profile: AccountSummary;
  /** Show the name next to the avatar (sidebar) or the avatar alone (headers). */
  showName?: boolean;
  side?: "top" | "bottom";
  align?: "start" | "end";
}

/**
 * The account menu: who is signed in (avatar, name, email), appearance, settings and
 * signing out. Nothing about the session itself (tokens, ids, expiry) is shown.
 */
export function ProfileMenu({ profile, showName = false, side = "bottom", align = "end" }: ProfileMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const theme = useThemePreference();
  useAccountTheme(profile.theme_preference);
  const name = `${profile.first_name} ${profile.last_name}`;

  const themeItems: MenuItem[] = (["light", "dark", "system"] as const).map((option, index) => ({
    id: `theme-${option}`,
    label: `${THEME_LABELS[option]} theme`,
    icon: THEME_ICONS[option],
    checked: theme === option,
    separated: index === 0,
    onSelect: () => chooseTheme(option),
  }));

  return (
    <DropdownMenu
      label="Account"
      side={side}
      align={align}
      header={
        <div className="mb-1 flex items-center gap-3 border-b border-line px-2.5 pb-3 pt-1.5">
          <Avatar person={profile} size="md" decorative />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-[13px] text-muted">{profile.email ?? `@${profile.username}`}</p>
          </div>
        </div>
      }
      items={[
        { id: "settings", label: "Account settings", icon: <Settings />, onSelect: () => router.push("/settings") },
        ...themeItems,
        {
          id: "logout",
          label: pending ? "Signing out…" : "Sign out",
          icon: <LogOut />,
          separated: true,
          disabled: pending,
          onSelect: () => startTransition(() => logoutAction()),
        },
        {
          id: "logout-everywhere",
          label: "Sign out everywhere",
          icon: <ShieldOff />,
          disabled: pending,
          onSelect: () => startTransition(() => logoutEverywhereAction()),
        },
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className={cn(
            "flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-control text-left transition-colors hover:bg-ink/6",
            showName ? "w-full justify-start p-2" : "rounded-full",
          )}
        >
          <Avatar person={profile} size={showName ? "md" : "sm"} decorative />
          {showName ? (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-[13px] text-muted">@{profile.username}</span>
            </span>
          ) : null}
        </button>
      }
    />
  );
}
