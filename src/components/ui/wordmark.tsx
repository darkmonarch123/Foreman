import { cn } from "@/lib/cn";

/**
 * The product wordmark. Rendered as real, visibly spaced lowercase letters
 * ("f o r e m a n") with an accessible name of "Foreman".
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block", className)} role="img" aria-label="Foreman">
      <span className="wordmark" aria-hidden="true">
        foreman
      </span>
    </span>
  );
}
