"use client";

import { FolderOpen, Home, LayoutTemplate, Settings, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  {
    href: "/dashboard",
    label: "Home",
    icon: Home,
    match: (path: string, view: string | null) => path === "/dashboard" && !view,
  },
  {
    href: "/dashboard?view=mine",
    label: "My boards",
    icon: FolderOpen,
    match: (path: string, view: string | null) => path === "/dashboard" && view === "mine",
  },
  {
    href: "/dashboard?view=shared",
    label: "Shared with me",
    icon: Users,
    match: (path: string, view: string | null) => path === "/dashboard" && view === "shared",
  },
  {
    href: "/templates",
    label: "Templates",
    icon: LayoutTemplate,
    match: (path: string) => path.startsWith("/templates"),
  },
  {
    href: "/dashboard?view=trash",
    label: "Trash",
    icon: Trash2,
    match: (path: string, view: string | null) => path === "/dashboard" && view === "trash",
  },
  { href: "/settings", label: "Settings", icon: Settings, match: (path: string) => path === "/settings" },
];

export function SidebarNav({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  return (
    <ul className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "overflow-x-auto")}>
      {items.map((item) => {
        const active = item.match(pathname, view);
        const Icon = item.icon;
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-control px-3 py-2.5 text-sm transition-colors",
                active ? "bg-ink text-white" : "text-ink/75 hover:bg-ink/6 hover:text-ink",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Rendered while the active route is not yet known. Same links, no highlight. */
export function SidebarNavFallback({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  return (
    <ul className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "overflow-x-auto")}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              className="flex items-center gap-3 rounded-control px-3 py-2.5 text-sm text-ink/75 hover:bg-ink/6"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
