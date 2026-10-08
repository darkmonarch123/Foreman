import { Check, CloudOff, Eye, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { BoardRole } from "@/lib/board/types";
import { Spinner } from "./spinner";

const roleStyles: Record<BoardRole, string> = {
  OWNER: "bg-ink text-white border-ink",
  EDITOR: "bg-lavender-tint text-ink border-lavender",
  VIEWER: "bg-surface text-muted border-line-strong",
};

const roleLabels: Record<BoardRole, string> = { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" };

/** Role is always written out; colour is a secondary cue only. */
export function RoleBadge({ role, className }: { role: BoardRole; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium",
        roleStyles[role],
        className,
      )}
    >
      {roleLabels[role]}
    </span>
  );
}

export type SyncStatus = "saved" | "saving" | "offline" | "reconnecting" | "failed" | "view-only";

const statusConfig: Record<SyncStatus, { label: string; className: string; icon: ReactNode }> = {
  saved: { label: "Saved", className: "text-success", icon: <Check className="size-3.5" aria-hidden /> },
  saving: { label: "Saving", className: "text-muted", icon: <Spinner className="size-3.5" /> },
  offline: { label: "Offline", className: "text-warning", icon: <CloudOff className="size-3.5" aria-hidden /> },
  reconnecting: {
    label: "Reconnecting",
    className: "text-warning",
    icon: <RefreshCw className="size-3.5 animate-spin-slow" aria-hidden />,
  },
  failed: { label: "Sync failed", className: "text-error", icon: <TriangleAlert className="size-3.5" aria-hidden /> },
  "view-only": { label: "View only", className: "text-muted", icon: <Eye className="size-3.5" aria-hidden /> },
};

export function statusLabel(status: SyncStatus): string {
  return statusConfig[status].label;
}

/** Save/connection state. Announced politely when it changes. */
export function StatusBadge({ status, className }: { status: SyncStatus; className?: string }) {
  const config = statusConfig[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", config.className, className)}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
