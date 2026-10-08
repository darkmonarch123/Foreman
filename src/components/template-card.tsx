import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { BoardPreview, type PreviewObject } from "@/components/board/board-preview";
import { Pill } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

interface TemplateCardProps {
  name: string;
  description: string;
  category: string;
  content: PreviewObject[];
  /** Set when the viewer's plan does not include this template. */
  lockedPlan?: string;
  featured?: boolean;
  action?: ReactNode;
  className?: string;
}

export function TemplateCard({
  name,
  description,
  category,
  content,
  lockedPlan,
  featured,
  action,
  className,
}: TemplateCardProps) {
  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-shadow duration-200 hover:shadow-soft",
        className,
      )}
    >
      <div className="canvas-grid relative aspect-[16/10] border-b border-line [background-size:14px_14px]">
        <BoardPreview objects={content} label={`Preview of the ${name} template`} padding={60} className="p-3" />
        {lockedPlan ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white">
            <Lock className="size-3" aria-hidden />
            {lockedPlan} plan
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{category}</Pill>
          {featured ? <Pill className="border-yellow bg-yellow-tint text-ink">Featured</Pill> : null}
        </div>
        <h3 className="font-display text-xl tracking-tight">{name}</h3>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
        {action ? <div className="mt-auto pt-3">{action}</div> : null}
      </div>
    </article>
  );
}
