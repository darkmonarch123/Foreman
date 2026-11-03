import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";

interface FeatureCardProps {
  icon: ReactNode;
  /** Background for the icon tile, as a class (for example bg-site-plan). */
  iconClassName: string;
  title: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** One short feature: icon, name and a sentence. */
export function FeatureCard({ icon, iconClassName, title, children, className, style }: FeatureCardProps) {
  return (
    <Card interactive className={cn("group px-[1.375rem] py-7", className)} style={style}>
      <div
        aria-hidden
        className={cn(
          "mb-[1.125rem] grid size-10 place-items-center rounded-[0.6875rem] transition-transform duration-500 ease-site-spring",
          "group-hover:-rotate-6 group-hover:scale-110 motion-reduce:group-hover:transform-none",
          iconClassName,
        )}
      >
        {icon}
      </div>
      <h3 className="mb-1.5 text-site-body font-semibold">{title}</h3>
      <p className="text-site-small text-site-label-2">{children}</p>
    </Card>
  );
}
