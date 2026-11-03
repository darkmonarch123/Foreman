"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/lib/spring";

export interface GalleryTemplate {
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
}

const PREVIEW: Record<string, string> = {
  PLANNING: "linear-gradient(135deg,#bcdcf5,#e3effa)",
  BRAINSTORMING: "linear-gradient(135deg,#ffe28a,#fff4c8)",
  PRODUCT: "linear-gradient(135deg,#c4c6f4,#ebebfb)",
  ENGINEERING: "linear-gradient(135deg,#ffc2d4,#fde8ef)",
  STUDY: "linear-gradient(135deg,#bfe5c9,#e6f4ea)",
};

interface TemplateGalleryProps {
  templates: GalleryTemplate[];
  categories: { id: string; label: string }[];
}

/**
 * Templates with a segmented filter. The filter is a group of toggle buttons
 * (aria-pressed); the highlight slides to the chosen one, and cards that remain
 * glide to their new places (FLIP), or simply fade with reduced motion.
 */
export function TemplateGallery({ templates, categories }: TemplateGalleryProps) {
  const [filter, setFilter] = useState("ALL");
  const options = [
    { id: "ALL", label: "All" },
    ...categories.filter((c) => templates.some((t) => t.category === c.id)),
  ];
  const groupRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);

  const placeThumb = useCallback(() => {
    const active = groupRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!active || !thumbRef.current) return;
    thumbRef.current.style.width = `${active.offsetWidth}px`;
    thumbRef.current.style.transform = `translateX(${active.offsetLeft}px)`;
  }, []);

  useLayoutEffect(() => {
    placeThumb();
    window.addEventListener("resize", placeThumb);
    return () => window.removeEventListener("resize", placeThumb);
  }, [placeThumb]);

  // After the filter changes: move the highlight, and play the cards from where they were.
  useLayoutEffect(() => {
    placeThumb();
    const previous = before.current;
    before.current = null;
    if (!previous || !gridRef.current) return;
    const reduce = prefersReducedMotion();
    for (const item of gridRef.current.querySelectorAll<HTMLElement>("[data-slug]")) {
      const from = previous.get(item.dataset.slug ?? "");
      const to = item.getBoundingClientRect();
      if (reduce || !from) {
        item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 200 : 450 });
      } else if (from.left !== to.left || from.top !== to.top) {
        item.animate(
          [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }],
          { duration: 600, easing: "cubic-bezier(.34,1.2,.64,1)" },
        );
      }
    }
  }, [filter, placeThumb]);

  const choose = (id: string) => {
    if (id === filter) return;
    const positions = new Map<string, DOMRect>();
    gridRef.current?.querySelectorAll<HTMLElement>("[data-slug]").forEach((item) => {
      positions.set(item.dataset.slug ?? "", item.getBoundingClientRect());
    });
    before.current = positions;
    setFilter(id);
  };

  const visible = templates.filter((template) => filter === "ALL" || template.category === filter);

  return (
    <>
      <div data-reveal className="mt-10 flex justify-center">
        <div
          ref={groupRef}
          role="group"
          aria-label="Filter templates by category"
          className="site-glass relative inline-flex max-w-full overflow-x-auto rounded-full p-[5px] [scrollbar-width:none]"
        >
          <span
            ref={thumbRef}
            aria-hidden
            className="absolute left-0 top-[5px] h-[calc(100%-10px)] rounded-full bg-white/90 shadow-[inset_0_1px_0_#fff,0_3px_10px_rgb(0_0_0/0.12)] transition-[transform,width] duration-500 ease-site-spring motion-reduce:transition-none dark:bg-white/15 dark:shadow-none"
          />
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => choose(option.id)}
              className="relative z-[1] min-h-11 whitespace-nowrap rounded-full px-4 text-site-small font-medium text-site-label-2 transition-colors aria-pressed:text-site-label"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {filter === "ALL"
          ? `Showing all ${visible.length} templates`
          : `Showing ${visible.length} ${options.find((o) => o.id === filter)?.label} templates`}
      </p>
      <ul ref={gridRef} className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((template) => (
          <li
            key={template.slug}
            data-slug={template.slug}
            className="group relative flex flex-col overflow-hidden rounded-site-md bg-site-surface transition-shadow duration-300 hover:shadow-site-hover"
          >
            <div
              aria-hidden
              className="flex h-[9.375rem] items-start gap-2 p-[1.375rem]"
              style={{ background: PREVIEW[template.category] }}
            >
              <i className="block h-[60%] flex-1 rounded-lg bg-white/65 transition-[height] duration-700 ease-site-spring group-hover:h-[80%]" />
              <i className="block h-[85%] flex-1 rounded-lg bg-white/65 transition-[height] duration-700 ease-site-spring group-hover:h-1/2" />
              <i className="block h-[45%] flex-1 rounded-lg bg-white/65 transition-[height] duration-700 ease-site-spring group-hover:h-[90%]" />
            </div>
            <div className="flex flex-1 flex-col px-6 pb-6 pt-5">
              <span className="text-site-caption font-semibold uppercase tracking-[0.04em] text-site-label-2">
                {template.categoryLabel}
              </span>
              <h3 className="mb-1.5 mt-1 text-[1.1875rem] font-semibold tracking-[-0.02em]">{template.name}</h3>
              <p className="flex-1 text-[0.9375rem] text-site-label-2">{template.description}</p>
              {/* The link covers the whole card, so the card is one large target. */}
              <Link
                href={`/boards/new?template=${template.slug}`}
                className={cn(
                  "site-link-arrow mt-3.5 min-h-11 self-start text-[0.9375rem]",
                  "before:absolute before:inset-0 before:content-['']",
                )}
              >
                Use template<span className="sr-only">: {template.name}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
