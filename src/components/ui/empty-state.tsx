import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 rounded-card border border-dashed border-line-strong px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-full bg-yellow-tint text-ink",
            compact ? "size-10" : "size-14",
          )}
        >
          {icon}
        </span>
      ) : null}
      <p className={cn(compact ? "text-sm font-medium" : "font-display text-2xl tracking-tight")}>{title}</p>
      {description ? (
        <p className={cn("max-w-sm text-muted", compact ? "text-[13px] leading-snug" : "text-[15px] leading-relaxed")}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
