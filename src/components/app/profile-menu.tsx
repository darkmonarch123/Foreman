"use client";

import { LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu } from "@/components/ui/menu";
import { logoutAction } from "@/lib/auth/actions";
import type { Profile } from "@/lib/auth/types";
import { cn } from "@/lib/cn";

interface ProfileMenuProps {
  profile: Pick<Profile, "first_name" | "last_name" | "username" | "avatar_url">;
  /** Show the name next to the avatar (sidebar) or the avatar alone (headers). */
  showName?: boolean;
  side?: "top" | "bottom";
  align?: "start" | "end";
}

export function ProfileMenu({ profile, showName = false, side = "bottom", align = "end" }: ProfileMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const name = `${profile.first_name} ${profile.last_name}`;

  return (
    <DropdownMenu
      label="Account"
      side={side}
      align={align}
      items={[
        { id: "settings", label: "Account settings", icon: <Settings />, onSelect: () => router.push("/settings") },
        {
          id: "logout",
          label: pending ? "Logging out…" : "Log out",
          icon: <LogOut />,
          separated: true,
          onSelect: () => startTransition(() => logoutAction()),
        },
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className={cn(
            "flex items-center gap-3 rounded-control text-left transition-colors hover:bg-ink/6",
            showName ? "w-full p-2" : "rounded-full",
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
