import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * The site's content column: 1080px wide at most, with a 22px gutter that grows to
 * clear the notch and home indicator in landscape (safe-area insets).
 */
export function Container({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[calc(var(--container-site)+2.75rem)]",
        "pl-[max(1.375rem,env(safe-area-inset-left))] pr-[max(1.375rem,env(safe-area-inset-right))]",
        className,
      )}
      {...rest}
    />
  );
}
