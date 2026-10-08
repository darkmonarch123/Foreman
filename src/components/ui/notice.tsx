import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "error" | "success" | "info" | "warning";

const tones: Record<Tone, { className: string; icon: ReactNode }> = {
  error: {
    className: "border-error/30 bg-coral-tint text-[#7d241b]",
    icon: <CircleAlert className="size-4" aria-hidden />,
  },
  success: {
    className: "border-success/30 bg-mint-tint text-[#17563a]",
    icon: <CircleCheck className="size-4" aria-hidden />,
  },
  info: { className: "border-line bg-sky-tint text-ink", icon: <Info className="size-4" aria-hidden /> },
  warning: {
    className: "border-warning/30 bg-yellow-tint text-[#6b470f]",
    icon: <CircleAlert className="size-4" aria-hidden />,
  },
};

/** Inline message that stays on screen (unlike a toast). Errors are announced immediately. */
export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-control border px-3.5 py-3 text-sm leading-snug",
        tones[tone].className,
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">{tones[tone].icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
