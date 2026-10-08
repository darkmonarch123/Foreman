import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-shimmer rounded-lg bg-[linear-gradient(90deg,#efebe4_25%,#f7f4ee_50%,#efebe4_75%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

/** Wraps skeletons so assistive technology hears one "Loading" instead of nothing. */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}
