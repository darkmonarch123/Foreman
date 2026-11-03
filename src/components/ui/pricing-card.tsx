import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";
import { Card } from "./card";

interface PricingCardProps {
  name: string;
  price: string;
  priceNote?: string;
  status: string;
  /** The plan people can choose today. Highlighted with a ring, not colour alone: it also says "Available now". */
  featured?: boolean;
  description: string;
  features: string[];
  action: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PricingCard({
  name,
  price,
  priceNote,
  status,
  featured,
  description,
  features,
  action,
  className,
  style,
}: PricingCardProps) {
  return (
    <Card
      tone={featured ? "surface" : "muted"}
      size="lg"
      className={cn(
        "flex flex-col px-8 py-9",
        featured && "shadow-[0_24px_48px_-24px_rgb(0_113_227/0.35)] ring-2 ring-site-accent",
        className,
      )}
      style={style}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-2xl font-bold tracking-[-0.03em]">{name}</h3>
        <Badge tone={featured ? "accent" : "neutral"}>{status}</Badge>
      </div>
      <p className="mb-0.5 mt-3 text-[2.5rem] font-bold leading-tight tracking-[-0.04em]">
        {price}
        {priceNote ? (
          <span className="ml-1.5 text-site-body font-medium tracking-[-0.01em] text-site-label-2">{priceNote}</span>
        ) : null}
      </p>
      <p className="text-site-small text-site-label-2">{description}</p>
      <ul className="mb-7 mt-6 grid flex-1 content-start gap-2.5 text-[0.9375rem]">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-full bg-site-accent/12 text-site-link"
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {action}
    </Card>
  );
}
