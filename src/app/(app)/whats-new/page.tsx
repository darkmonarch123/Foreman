import { ArrowRight, Eye, Keyboard, ListChecks, MousePointerClick, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { LinkButton } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { tryAssistantHref } from "@/lib/announcements";
import { isAssistantEnabled } from "@/lib/assistant/flag";
import { requireProfile } from "@/lib/auth/dal";
import { listBoards } from "@/lib/boards/data";

export const metadata: Metadata = { title: "What’s new" };

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-warm px-1.5 py-0.5 font-sans text-xs text-ink">{children}</kbd>
  );
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-card border border-line bg-surface p-5">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lavender-tint text-ink"
        aria-hidden
      >
        {icon}
      </span>
      <div>
        <h3 className="text-[15px] font-medium">{title}</h3>
        <div className="mt-1.5 text-sm leading-relaxed text-ink/80">{children}</div>
      </div>
    </li>
  );
}

async function WhatsNewContent() {
  await requireProfile("/whats-new");
  if (!isAssistantEnabled()) notFound();
  const href = await tryAssistantHref(() => listBoards("all"));
  const hasBoard = href.includes("?assistant=open");

  return (
    <article className="mx-auto max-w-3xl">
      <header className="rounded-panel bg-lavender-tint px-6 py-9 sm:px-10 sm:py-12">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium">
          <Sparkles className="size-3.5" aria-hidden />
          New
        </p>
        <h1 className="mt-5 font-display text-headline">What’s new on Foreman</h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink/80">
          <strong className="font-medium text-ink">Foreman Assistant</strong> reads your board and points out what a
          plan is missing: unanswered questions, actions with no owner, vague notes, duplicates, and loose ends. It
          suggests new notes for each one, and you decide what goes on the board.
        </p>
      </header>

      <section aria-labelledby="how-heading" className="mt-12">
        <h2 id="how-heading" className="font-display text-title">
          How to use it
        </h2>
        <ol className="mt-6 flex flex-col gap-3">
          <Step icon={<Keyboard className="size-[18px]" />} title="Open it">
            On any board, press <Kbd>F</Kbd> or click <strong className="font-medium">Foreman Assistant</strong> in the
            top bar. You can also right-click the canvas or an item, or use the sparkle button on a selected item. The
            panel opens beside the board, so you can keep working.
          </Step>
          <Step icon={<ListChecks className="size-[18px]" />} title="Choose what it should do">
            <strong className="font-medium">Explain this board</strong> summarizes the board and its open questions.{" "}
            <strong className="font-medium">Find planning gaps</strong> lists what looks unfinished.{" "}
            <strong className="font-medium">Propose a plan</strong> also suggests decisions for recurring themes. Look
            at the whole board or one selected item, and add guidance such as “do not include billing” to leave
            something out.
          </Step>
          <Step icon={<MousePointerClick className="size-[18px]" />} title="Check each finding">
            Every finding says whether it is a <em>fact</em>, an <em>inference</em> or a <em>suggestion</em>, how
            confident it is, and which notes it is based on. Click <strong className="font-medium">View</strong> to jump
            to them.
          </Step>
          <Step icon={<Eye className="size-[18px]" />} title="Preview, edit, then accept or reject">
            <strong className="font-medium">Preview on board</strong> shows a faint outline of the suggested note that
            only you can see. Edit the text if you like, then <strong className="font-medium">Accept</strong> to add it
            or <strong className="font-medium">Reject</strong> to drop it. Each proposal is decided on its own; nothing
            is ever added without you.
          </Step>
          <Step icon={<Undo2 className="size-[18px]" />} title="Undo any accepted suggestion">
            Use <strong className="font-medium">Undo this</strong> on the card, or <Kbd>Ctrl</Kbd> <Kbd>Z</Kbd>. It
            removes only that note and leaves everyone else’s work alone. If someone changes the board after a
            suggestion was made, it is marked out of date and can’t be applied.
          </Step>
        </ol>
      </section>

      <section aria-labelledby="who-heading" className="mt-12">
        <h2 id="who-heading" className="font-display text-title">
          Who can use it
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          Owners and editors can use everything. Viewers can explain a board and find planning gaps, and preview
          suggestions, but can’t add anything to the board.
        </p>
      </section>

      <section aria-labelledby="privacy-heading" className="mt-12">
        <h2 id="privacy-heading" className="flex items-center gap-2 font-display text-title">
          <ShieldCheck className="size-6" aria-hidden />
          Private by design
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          Foreman Assistant follows fixed rules inside Foreman. It doesn’t use an outside AI service, and your board
          content isn’t sent anywhere else. It only reads boards you can already see.
        </p>
      </section>

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-line pt-8">
        <LinkButton href={href}>
          {hasBoard ? "Try it on a board" : "Create a board to try it"}
          <ArrowRight className="size-4" aria-hidden />
        </LinkButton>
        <LinkButton href="/dashboard" variant="ghost">
          Back to dashboard
        </LinkButton>
      </div>
    </article>
  );
}

function WhatsNewSkeleton() {
  return (
    <LoadingRegion label="Loading what’s new">
      <div className="mx-auto max-w-3xl">
        <Skeleton className="h-64 rounded-panel" />
        <Skeleton className="mt-12 h-8 w-56" />
        <Skeleton className="mt-6 h-28 rounded-card" />
        <Skeleton className="mt-3 h-28 rounded-card" />
      </div>
    </LoadingRegion>
  );
}

export default function WhatsNewPage() {
  return (
    <Suspense fallback={<WhatsNewSkeleton />}>
      <WhatsNewContent />
    </Suspense>
  );
}
