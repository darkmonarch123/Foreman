import { LayoutTemplate, Search, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TemplateGallery } from "@/components/app/template-gallery";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import { listTemplates } from "@/lib/boards/data";
import type { TemplateRow } from "@/lib/boards/types";
import { cn } from "@/lib/cn";
import { toAppError } from "@/lib/errors";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/templates/catalog";
import { PLANS, formatCapacity } from "@/lib/templates/plans";

export const metadata: Metadata = { title: "Templates" };

const PAGE_SIZE = 9;

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function href(params: { category?: string; q?: string; page?: number }): string {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.q) search.set("q", params.q);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/templates?${query}` : "/templates";
}

async function TemplatesContent({ searchParams }: { searchParams: Search }) {
  const profile = await requireProfile("/templates");
  const params = await searchParams;
  const query = first(params.q)?.trim().slice(0, 80) || undefined;
  const requestedCategory = first(params.category)?.toUpperCase();
  const category = TEMPLATE_CATEGORIES.find((entry) => entry.id === requestedCategory)?.id as
    TemplateCategory | undefined;
  const requestedPage = Number.parseInt(first(params.page) ?? "1", 10);

  let all: TemplateRow[];
  try {
    all = await listTemplates();
  } catch (error) {
    return (
      <EmptyState
        icon={<TriangleAlert className="size-6" />}
        title="Templates couldn’t be loaded"
        description={toAppError(error).message}
        action={
          <LinkButton href="/templates" variant="secondary">
            Try again
          </LinkButton>
        }
      />
    );
  }

  const needle = query?.toLowerCase();
  const filtered = all.filter(
    (template) =>
      (!category || template.category === category) &&
      (!needle || template.name.toLowerCase().includes(needle) || template.description.toLowerCase().includes(needle)),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), pageCount) : 1;
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const plan = PLANS[profile.plan];

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Template categories">
          <ul className="flex flex-wrap gap-1.5">
            {[{ id: undefined, label: "All" }, ...TEMPLATE_CATEGORIES].map((entry) => {
              const active = entry.id === category;
              return (
                <li key={entry.label}>
                  <Link
                    href={href({ category: entry.id?.toLowerCase(), q: query })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors",
                      active
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-surface text-ink hover:border-line-strong",
                    )}
                  >
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <form action="/templates" method="get" role="search" className="relative w-full lg:w-72">
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
            defaultValue={query}
            maxLength={80}
            placeholder="Search templates"
            className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm placeholder:text-muted/70 hover:border-line-strong focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
          />
        </form>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate className="size-6" />}
          title="No templates match"
          description="Try a different category or search term."
          action={
            <LinkButton href="/templates" variant="secondary">
              Show all templates
            </LinkButton>
          }
        />
      ) : (
        <TemplateGallery templates={visible} plan={profile.plan} />
      )}

      {pageCount > 1 ? (
        <nav aria-label="Template pages" className="mt-10 flex items-center justify-center gap-3">
          {page > 1 ? (
            <LinkButton
              href={href({ category: category?.toLowerCase(), q: query, page: page - 1 })}
              variant="secondary"
              size="sm"
            >
              Previous
            </LinkButton>
          ) : null}
          <p className="text-sm text-muted" aria-live="polite">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <LinkButton
              href={href({ category: category?.toLowerCase(), q: query, page: page + 1 })}
              variant="secondary"
              size="sm"
            >
              Next
            </LinkButton>
          ) : null}
        </nav>
      ) : null}

      <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-muted">
        Showing {filtered.length} of {all.length} templates in the library. You are on the {plan.name} plan, which
        allows up to {formatCapacity(plan.templateCapacity)} templates as the library grows.
      </p>
    </>
  );
}

export default function TemplatesPage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="font-display text-headline">Templates</h1>
      <p className="mb-8 mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
        Start from a layout that already has structure. Every template opens as a normal, fully editable board.
      </p>
      <Suspense
        fallback={
          <LoadingRegion label="Loading templates" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/3.6] rounded-card" />
            ))}
          </LoadingRegion>
        }
      >
        <TemplatesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
