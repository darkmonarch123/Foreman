import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type CardTone = "surface" | "muted" | "dark";

const tones: Record<CardTone, string> = {
  surface: "bg-site-surface",
  muted: "bg-site-bg-alt",
  // Stays dark in both modes; a hairline keeps its edge visible on a black page.
  dark: "bg-[#1d1d1f] text-[#f5f5f7] dark:ring-1 dark:ring-white/10",
};

interface CardProps extends ComponentProps<"div"> {
  tone?: CardTone;
  size?: "md" | "lg";
  /** Lifts slightly on hover (pointer devices; never with reduced motion). */
  interactive?: boolean;
}

/** A rounded surface on the site. Size sets the radius: md = 18px, lg = 28px. */
export function Card({ tone = "surface", size = "md", interactive, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        tones[tone],
        size === "lg" ? "rounded-site-lg" : "rounded-site-md",
        interactive &&
          "transition-[transform,box-shadow] duration-500 ease-site-spring hover:-translate-y-1.5 hover:shadow-site-hover motion-reduce:hover:translate-y-0",
        className,
      )}
      {...rest}
    />
  );
}
