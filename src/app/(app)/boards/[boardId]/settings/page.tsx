import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardSettingsView } from "@/components/app/board-settings-view";
import { BoardUnavailable } from "@/components/board/board-unavailable";
import { ErrorPanel } from "@/components/board/static-error";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";
import { getBoard, isUuid } from "@/lib/boards/data";
import { toAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Board settings" };

type Params = Promise<{ boardId: string }>;

async function Settings({ params }: { params: Params }) {
  const { boardId } = await params;
  const profile = await requireProfile(isUuid(boardId) ? `/boards/${boardId}/settings` : "/dashboard");

  let board;
  try {
    board = await getBoard(boardId);
  } catch (error) {
    return <ErrorPanel message={toAppError(error).message} retryHref={`/boards/${boardId}/settings`} />;
  }
  if (!board) return <BoardUnavailable />;

  if (board.role !== "OWNER") {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Only the owner can change board settings"
        description="You can still open the board. Ask its owner if something about sharing needs to change."
        action={<LinkButton href={`/boards/${board.id}`}>Open board</LinkButton>}
      />
    );
  }
  return <BoardSettingsView board={board} currentUserId={profile.id} />;
}

export default function BoardSettingsPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense
        fallback={
          <LoadingRegion label="Loading board settings">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="mt-8 h-10" />
            <Skeleton className="mt-8 h-64 rounded-card" />
          </LoadingRegion>
        }
      >
        <Settings params={params} />
      </Suspense>
    </div>
  );
}
