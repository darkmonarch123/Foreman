import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Container } from "./container";

interface SectionProps extends Omit<ComponentProps<"section">, "title"> {
  /** "alt" uses the slightly darker band that separates neighbouring sections. */
  tone?: "default" | "alt";
  /** Content placed behind the column, such as the aurora. */
  backdrop?: ReactNode;
  containerClassName?: string;
}

/** A full-width band of the landing page with consistent vertical rhythm. */
export function Section({
  tone = "default",
  backdrop,
  className,
  containerClassName,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      className={cn(
        "relative scroll-mt-24 py-section-sm sm:py-section",
        tone === "alt" ? "bg-site-bg-alt" : "bg-site-bg",
        backdrop ? "overflow-clip" : undefined,
        className,
      )}
      {...rest}
    >
      {backdrop}
      <Container className={cn("relative", containerClassName)}>{children}</Container>
    </section>
  );
}

interface SectionHeadingProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Heading id, for aria-labelledby on the section. */
  id?: string;
  align?: "center" | "start";
  /** The heading sits on the aurora: use the darker secondary colour for the subtitle. */
  onTint?: boolean;
  className?: string;
}

export function SectionHeading({ title, subtitle, id, align = "center", onTint, className }: SectionHeadingProps) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      <h2
        id={id}
        data-reveal
        className={cn("text-site-h2 text-balance", align === "center" ? "mx-auto max-w-[18ch]" : "max-w-[14ch]")}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          data-reveal
          className={cn(
            "mt-4 text-site-sub text-balance",
            onTint ? "text-site-label-on-tint" : "text-site-label-2",
            align === "center" ? "mx-auto max-w-[40ch]" : "max-w-[40ch]",
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
