import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TemplateBrowser } from "@/components/app/template-browser";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import { listTemplates } from "@/lib/boards/data";
import type { TemplateRow } from "@/lib/boards/types";
import { toAppError } from "@/lib/errors";
import { timeServer } from "@/lib/perf/server";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/templates/catalog";
import { PLANS, formatCapacity } from "@/lib/templates/plans";

export const metadata: Metadata = { title: "Templates" };

const PAGE_SIZE = 9;

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
    all = await timeServer("template_search", { userId: profile.id }, () => listTemplates());
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

  const plan = PLANS[profile.plan];
  const requested = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  return (
    <>
      <TemplateBrowser
        templates={all}
        categories={TEMPLATE_CATEGORIES}
        plan={profile.plan}
        initialCategory={category}
        initialQuery={query ?? ""}
        initialPage={requested}
        pageSize={PAGE_SIZE}
      />
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">
        You are on the {plan.name} plan, which allows up to {formatCapacity(plan.templateCapacity)} templates as the
        library grows.
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
