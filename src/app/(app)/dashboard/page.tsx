import { FolderOpen, Inbox, LayoutTemplate, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { BoardCard } from "@/components/app/board-card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import { listBoards } from "@/lib/boards/data";
import type { BoardListItem, BoardScope } from "@/lib/boards/types";
import { toAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Dashboard" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function BoardGrid({ boards }: { boards: BoardListItem[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {boards.map((board) => (
        <li key={board.id}>
          <BoardCard board={board} />
        </li>
      ))}
    </ul>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="mb-5 flex items-baseline gap-3 font-display text-2xl tracking-tight">
        {title}
        {count !== undefined ? <span className="font-sans text-sm text-muted">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-headline">{title}</h1>
        {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/templates" variant="secondary">
          <LayoutTemplate className="size-4" aria-hidden />
          Browse templates
        </LinkButton>
        <LinkButton href="/boards/new">
          <Plus className="size-4" aria-hidden />
          Create board
        </LinkButton>
      </div>
    </div>
  );
}

async function DashboardContent({ searchParams }: { searchParams: Search }) {
  const profile = await requireProfile("/dashboard");
  const params = await searchParams;
  const view = first(params.view);
  const query = first(params.q)?.trim().slice(0, 120) || undefined;
  const scope: BoardScope = view === "mine" || view === "shared" || view === "trash" ? view : "all";

  let boards: BoardListItem[];
  try {
    boards = await listBoards(scope, query);
  } catch (error) {
    return (
      <>
        <PageHeader title="Your boards" />
        <EmptyState
          icon={<TriangleAlert className="size-6" />}
          title="Your boards couldn’t be loaded"
          description={toAppError(error).message}
          action={
            <LinkButton href="/dashboard" variant="secondary">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }

  if (query) {
    return (
      <>
        <PageHeader title="Search" subtitle={`Boards matching “${query}”`} />
        {boards.length === 0 ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="No boards match that search"
            description="Check the spelling, or search for part of the board’s name."
            action={
              <LinkButton href="/dashboard" variant="secondary">
                Clear search
              </LinkButton>
            }
          />
        ) : (
          <BoardGrid boards={boards} />
        )}
      </>
    );
  }

  if (scope === "trash") {
    return (
      <>
        <PageHeader title="Trash" subtitle="Boards you deleted. Restore them, or delete them forever." />
        {boards.length === 0 ? (
          <EmptyState
            icon={<Trash2 className="size-6" />}
            title="Trash is empty"
            description="Boards you delete will wait here until you remove them for good."
          />
        ) : (
          <BoardGrid boards={boards} />
        )}
      </>
    );
  }

  if (scope === "mine") {
    return (
      <>
        <PageHeader title="My boards" subtitle="Boards you own." />
        {boards.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="size-6" />}
            title="You don’t own any boards yet"
            description="Start with a blank canvas or pick a template."
            action={<LinkButton href="/boards/new">Create board</LinkButton>}
          />
        ) : (
          <BoardGrid boards={boards} />
        )}
      </>
    );
  }

  if (scope === "shared") {
    return (
      <>
        <PageHeader title="Shared with me" subtitle="Boards other people have added you to." />
        {boards.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="Nothing has been shared with you yet"
            description="When someone invites you to a board, or you join one with a collaboration code, it appears here."
            action={
              <LinkButton href="/join" variant="secondary">
                Join with a code
              </LinkButton>
            }
          />
        ) : (
          <BoardGrid boards={boards} />
        )}
      </>
    );
  }

  const mine = boards.filter((board) => board.role === "OWNER");
  const shared = boards.filter((board) => board.role !== "OWNER");

  if (boards.length === 0) {
    return (
      <>
        <PageHeader title={`Hello, ${profile.first_name}`} />
        <EmptyState
          icon={<FolderOpen className="size-6" />}
          title="You don’t have any boards yet"
          description="Create your first board from a blank canvas or a template. If someone gave you a collaboration code, you can join their board instead."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/boards/new">Create board</LinkButton>
              <LinkButton href="/templates" variant="secondary">
                Browse templates
              </LinkButton>
              <LinkButton href="/join" variant="ghost">
                Join with a code
              </LinkButton>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Hello, ${profile.first_name}`} />
      <Section title="Recent boards">
        <BoardGrid boards={boards.slice(0, 4)} />
      </Section>
      <Section title="My boards" count={mine.length}>
        {mine.length === 0 ? (
          <EmptyState
            compact
            title="You don’t own any boards yet"
            action={
              <LinkButton href="/boards/new" size="sm">
                Create board
              </LinkButton>
            }
          />
        ) : (
          <BoardGrid boards={mine} />
        )}
      </Section>
      <Section title="Shared with me" count={shared.length}>
        {shared.length === 0 ? (
          <EmptyState
            compact
            title="Nothing has been shared with you yet"
            description="Boards you are invited to appear here."
          />
        ) : (
          <BoardGrid boards={shared} />
        )}
      </Section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading your boards">
      <Skeleton className="h-12 w-72" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-[16/14] rounded-card" />
        ))}
      </div>
    </LoadingRegion>
  );
}

export default function DashboardPage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="mx-auto max-w-7xl">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
