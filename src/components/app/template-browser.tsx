"use client";

import { LayoutTemplate, Search } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { TemplateRow } from "@/lib/boards/types";
import { cn } from "@/lib/cn";
import { startTimer } from "@/lib/perf/client";
import type { PlanId, TemplateCategory } from "@/lib/templates/catalog";
import { TemplateGallery } from "./template-gallery";

interface TemplateBrowserProps {
  templates: TemplateRow[];
  categories: { id: TemplateCategory; label: string }[];
  plan: PlanId;
  initialCategory?: TemplateCategory;
  initialQuery?: string;
  initialPage?: number;
  pageSize: number;
}

export function filterTemplates(templates: TemplateRow[], category: TemplateCategory | undefined, query: string) {
  const needle = query.trim().toLowerCase();
  return templates.filter(
    (template) =>
      (!category || template.category === category) &&
      (!needle || template.name.toLowerCase().includes(needle) || template.description.toLowerCase().includes(needle)),
  );
}

/**
 * Category filter, search and paging over the (cached) template catalog, entirely in the
 * browser: results change as you type, with no round trip. The address bar is kept in
 * step so a search can be shared or reloaded, and the form still submits normally
 * without JavaScript.
 */
export function TemplateBrowser({
  templates,
  categories,
  plan,
  initialCategory,
  initialQuery = "",
  initialPage = 1,
  pageSize,
}: TemplateBrowserProps) {
  const [category, setCategory] = useState<TemplateCategory | undefined>(initialCategory);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const timer = useRef<ReturnType<typeof startTimer> | null>(null);

  const filtered = useMemo(() => filterTemplates(templates, category, query), [templates, category, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const sync = (next: { category?: TemplateCategory; query: string; page: number }) => {
    const params = new URLSearchParams();
    if (next.category) params.set("category", next.category.toLowerCase());
    if (next.query.trim()) params.set("q", next.query.trim());
    if (next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    window.history.replaceState(window.history.state, "", search ? `/templates?${search}` : "/templates");
  };

  const update = (next: { category?: TemplateCategory; query: string; page: number }) => {
    timer.current = startTimer("template_search");
    setCategory(next.category);
    setQuery(next.query);
    setPage(next.page);
    sync(next);
    timer.current.endAfterPaint();
  };

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Template categories" className="flex flex-wrap gap-2">
          {[{ id: undefined, label: "All" }, ...categories].map((entry) => {
            const active = entry.id === category;
            return (
              <button
                key={entry.label}
                type="button"
                aria-pressed={active}
                onClick={() => update({ category: entry.id, query, page: 1 })}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors",
                  active
                    ? "border-ink bg-ink text-surface"
                    : "border-line bg-surface text-ink hover:border-line-strong",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <form
          action="/templates"
          method="get"
          role="search"
          className="relative w-full lg:w-72"
          onSubmit={(event: FormEvent) => event.preventDefault()}
        >
          {category ? <input type="hidden" name="category" value={category.toLowerCase()} /> : null}
          <label htmlFor="template-search" className="sr-only">
            Search templates
          </label>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            id="template-search"
            name="q"
            type="search"
            value={query}
            onChange={(event) => update({ category, query: event.target.value.slice(0, 80), page: 1 })}
            maxLength={80}
            placeholder="Search templates"
            className="h-11 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm placeholder:text-muted/70 hover:border-line-strong focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
          />
        </form>
      </div>

      <p className="sr-only" aria-live="polite">
        {filtered.length === 1 ? "1 template" : `${filtered.length} templates`}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate className="size-6" />}
          title="No templates match"
          description="Try a different category or search term."
          action={
            <Button variant="secondary" onClick={() => update({ category: undefined, query: "", page: 1 })}>
              Show all templates
            </Button>
          }
        />
      ) : (
        <TemplateGallery templates={visible} plan={plan} />
      )}

      {pageCount > 1 ? (
        <nav aria-label="Template pages" className="mt-10 flex items-center justify-center gap-3">
          {current > 1 ? (
            <Button variant="secondary" size="sm" onClick={() => update({ category, query, page: current - 1 })}>
              Previous
            </Button>
          ) : null}
          <p className="text-sm text-muted" aria-live="polite">
            Page {current} of {pageCount}
          </p>
          {current < pageCount ? (
            <Button variant="secondary" size="sm" onClick={() => update({ category, query, page: current + 1 })}>
              Next
            </Button>
          ) : null}
        </nav>
      ) : null}

      <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-muted">
        Showing {filtered.length} of {templates.length} templates in the library.
      </p>
    </>
  );
}
