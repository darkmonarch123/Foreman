import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateBoardForm } from "@/components/app/create-board-form";
import { Notice } from "@/components/ui/notice";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import { getTemplate } from "@/lib/boards/data";
import type { TemplateRow } from "@/lib/boards/types";
import { toAppError } from "@/lib/errors";
import { PLANS, planAllows } from "@/lib/templates/plans";

export const metadata: Metadata = { title: "Create a board" };

type Search = Promise<Record<string, string | string[] | undefined>>;

async function NewBoard({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const slug = Array.isArray(params.template) ? params.template[0] : params.template;
  const profile = await requireProfile(slug ? `/boards/new?template=${encodeURIComponent(slug)}` : "/boards/new");

  let template: TemplateRow | null = null;
  let notice: string | null = null;
  if (slug) {
    try {
      template = await getTemplate(slug);
      if (!template) {
        notice = "That template is no longer available, so this board will start blank.";
      } else if (!planAllows(profile.plan, template.min_plan)) {
        notice = `${template.name} is part of the ${PLANS[template.min_plan].name} plan, so this board will start blank.`;
        template = null;
      }
    } catch (error) {
      notice = toAppError(error).message;
    }
  }

  return (
    <>
      {notice ? (
        <Notice tone="warning" className="mb-6">
          {notice}
        </Notice>
      ) : null}
      <CreateBoardForm template={template} />
    </>
  );
}

export default function NewBoardPage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-8 font-display text-headline">Create a board</h1>
      <Suspense
        fallback={
          <LoadingRegion label="Loading" className="grid gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Skeleton className="h-16" />
              <Skeleton className="h-28" />
              <Skeleton className="h-64" />
            </div>
            <Skeleton className="h-72 rounded-card" />
          </LoadingRegion>
        }
      >
        <NewBoard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
