import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardClient } from "@/components/board/board-client";
import { BoardUnavailable } from "@/components/board/board-unavailable";
import { ErrorPanel } from "@/components/board/static-error";
import { Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import type { Member } from "@/lib/board/services";
import type { BoardState } from "@/lib/board/types";
import { isUuid, loadBoardPage } from "@/lib/boards/data";
import { isAssistantEnabled } from "@/lib/assistant/flag";
import { toAppError } from "@/lib/errors";
import { timeServer } from "@/lib/perf/server";

export const metadata: Metadata = { title: "Board" };

type Params = Promise<{ boardId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

async function BoardLoader({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { boardId } = await params;
  // `?assistant=open` (from the What’s new page) opens the Assistant panel on arrival.
  const openAssistant = (await searchParams).assistant === "open";
  const profile = await requireProfile(isUuid(boardId) ? `/boards/${boardId}` : "/dashboard");

  let loaded: { state: BoardState; members: Member[] } | null = null;
  let failure: string | null = null;
  try {
    loaded = await timeServer(
      "board_open",
      { boardId: isUuid(boardId) ? boardId : undefined, userId: profile.id },
      // One round trip for state and members; the database checks membership.
      () => loadBoardPage(boardId),
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code !== "BOARD_NOT_FOUND" && appError.code !== "BOARD_ACCESS_DENIED") failure = appError.message;
  }

  if (failure) return <ErrorPanel message={failure} retryHref={`/boards/${boardId}`} />;
  if (!loaded) return <BoardUnavailable />;

  return (
    <BoardClient
      initial={loaded.state}
      initialMembers={loaded.members}
      assistantEnabled={isAssistantEnabled()}
      initialAssistantOpen={openAssistant}
      currentUser={{
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        username: profile.username,
        avatar_url: profile.avatar_url,
        email: profile.email,
        theme_preference: profile.theme_preference,
      }}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-dvh flex-col" role="status" aria-label="Loading board">
      <div className="flex h-14 items-center gap-3 border-b border-line bg-surface px-3">
        <Skeleton className="size-9" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="ml-auto h-9 w-40 rounded-full" />
      </div>
      <div className="canvas-grid relative flex-1 [background-size:24px_24px]">
        <Skeleton className="absolute left-3 top-1/2 h-96 w-14 -translate-y-1/2 rounded-card" />
        <Skeleton className="absolute left-[18%] top-[22%] h-56 w-52 rounded-card" />
        <Skeleton className="absolute left-[40%] top-[22%] h-56 w-52 rounded-card" />
        <Skeleton className="absolute left-[62%] top-[22%] h-56 w-52 rounded-card" />
      </div>
      <span className="sr-only">Loading board</span>
    </div>
  );
}

export default function BoardPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <BoardLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
