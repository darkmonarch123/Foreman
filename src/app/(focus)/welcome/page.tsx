import { LayoutTemplate, Square } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BoardPreview } from "@/components/board/board-preview";
import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/ui/wordmark";
import { requireProfile } from "@/lib/auth/dal";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

export const metadata: Metadata = { title: "Welcome" };

const roadmap = TEMPLATE_CATALOG.find((template) => template.slug === "project-roadmap")!;

async function Greeting() {
  const profile = await requireProfile("/welcome");
  return <>Welcome to Foreman, {profile.first_name}.</>;
}

export default function WelcomePage() {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center justify-between">
        <Wordmark className="text-lg" />
        <Link href="/dashboard" className="rounded-full px-4 py-2 text-sm text-muted hover:bg-ink/6 hover:text-ink">
          Skip to dashboard
        </Link>
      </div>
      <main id="main" className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center py-12">
        <h1 className="font-display text-headline">
          <Suspense fallback={<Skeleton className="h-14 w-[28rem] max-w-full" />}>
            <Greeting />
          </Suspense>
        </h1>
        <p className="mt-3 text-xl text-muted">How would you like to begin?</p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Link
            href="/boards/new"
            className="group flex flex-col rounded-card border border-line bg-surface p-6 transition-shadow hover:shadow-soft"
          >
            <div className="canvas-grid flex aspect-[16/9] items-center justify-center rounded-control border border-line [background-size:16px_16px]">
              <Square className="size-8 text-line-strong" aria-hidden />
            </div>
            <span className="mt-5 font-display text-2xl tracking-tight underline-offset-4 group-hover:underline">
              Start with a blank board
            </span>
            <span className="mt-1.5 text-sm leading-relaxed text-muted">
              An empty canvas, ready for your first note.
            </span>
          </Link>
          <Link
            href="/templates"
            className="group flex flex-col rounded-card border border-line bg-surface p-6 transition-shadow hover:shadow-soft"
          >
            <div className="canvas-grid aspect-[16/9] rounded-control border border-line [background-size:16px_16px]">
              <BoardPreview objects={roadmap.content} simplified padding={60} className="p-2" />
            </div>
            <span className="mt-5 flex items-center gap-2 font-display text-2xl tracking-tight underline-offset-4 group-hover:underline">
              <LayoutTemplate className="size-5" aria-hidden />
              Use a template
            </span>
            <span className="mt-1.5 text-sm leading-relaxed text-muted">
              Six starting layouts for planning, study, product and engineering work.
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
