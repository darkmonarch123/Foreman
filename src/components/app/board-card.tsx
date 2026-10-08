"use client";

import { Copy, DoorOpen, Ellipsis, PenLine, RotateCcw, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BoardPreview, type PreviewObject } from "@/components/board/board-preview";
import { AvatarStack } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { DropdownMenu, type MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import {
  deleteBoardAction,
  duplicateBoardAction,
  leaveBoardAction,
  purgeBoardAction,
  restoreBoardAction,
  updateBoardAction,
} from "@/lib/boards/actions";
import type { BoardListItem } from "@/lib/boards/types";
import type { ActionResult } from "@/lib/errors";

function toPreview(board: BoardListItem): PreviewObject[] {
  return board.preview.map((item) => ({
    type: item.type,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    props: {
      ...(item.fill ? { fill: item.fill } : {}),
      ...(item.stroke ? { stroke: item.stroke } : {}),
      ...(item.type === "TEXT" ? { text: "text" } : {}),
    },
  }));
}

type Dialog = "rename" | "delete" | "purge" | "leave" | null;

export function BoardCard({ board }: { board: BoardListItem }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [title, setTitle] = useState(board.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inTrash = board.deleted_at !== null;
  const isOwner = board.role === "OWNER";

  function run<T>(action: () => Promise<ActionResult<T>>, success: string, after?: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        // Keep the message next to the action when a dialog is open; otherwise toast it.
        if (dialog) setError(result.fields?.title ?? result.message);
        else toast.error(result.message);
        return;
      }
      setDialog(null);
      toast.success(success);
      after?.(result.data);
      router.refresh();
    });
  }

  const items: MenuItem[] = inTrash
    ? [
        {
          id: "restore",
          label: "Restore",
          icon: <RotateCcw />,
          onSelect: () => run(() => restoreBoardAction({ boardId: board.id }), "Board restored."),
        },
        {
          id: "purge",
          label: "Delete forever",
          icon: <Trash2 />,
          danger: true,
          separated: true,
          onSelect: () => setDialog("purge"),
        },
      ]
    : [
        ...(isOwner
          ? [
              { id: "rename", label: "Rename", icon: <PenLine />, onSelect: () => setDialog("rename") },
              {
                id: "share",
                label: "Share",
                icon: <Share2 />,
                onSelect: () => router.push(`/boards/${board.id}/settings?tab=sharing`),
              },
            ]
          : []),
        ...(board.role !== "VIEWER"
          ? [
              {
                id: "duplicate",
                label: "Duplicate",
                icon: <Copy />,
                onSelect: () =>
                  run(
                    () => duplicateBoardAction({ boardId: board.id }),
                    "Board duplicated.",
                    (data) => router.push(`/boards/${data.id}`),
                  ),
              },
            ]
          : []),
        isOwner
          ? {
              id: "delete",
              label: "Delete",
              icon: <Trash2 />,
              danger: true,
              separated: true,
              onSelect: () => setDialog("delete"),
            }
          : {
              id: "leave",
              label: "Leave board",
              icon: <DoorOpen />,
              danger: true,
              separated: true,
              onSelect: () => setDialog("leave"),
            },
      ];

  const thumbnail = (
    <div className="canvas-grid aspect-[16/10] border-b border-line [background-size:14px_14px]">
      {board.preview.length > 0 ? (
        <BoardPreview objects={toPreview(board)} simplified padding={80} className="p-2" />
      ) : (
        <div className="flex size-full items-center justify-center text-[13px] text-muted">Empty board</div>
      )}
    </div>
  );

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-shadow duration-200 hover:shadow-soft">
      {inTrash ? (
        <div className="opacity-60">{thumbnail}</div>
      ) : (
        <Link href={`/boards/${board.id}`} tabIndex={-1} aria-hidden>
          {thumbnail}
        </Link>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[15px] font-medium leading-snug">
            {inTrash ? (
              <span className="line-clamp-2">{board.title}</span>
            ) : (
              <Link href={`/boards/${board.id}`} className="line-clamp-2 underline-offset-4 hover:underline">
                {board.title}
              </Link>
            )}
          </h3>
          <DropdownMenu
            label={`Actions for ${board.title}`}
            items={items}
            trigger={
              <IconButton
                label={`Actions for ${board.title}`}
                size="sm"
                className="-mr-1.5 -mt-1 shrink-0"
                disabled={pending}
              >
                <Ellipsis className="size-4" aria-hidden />
              </IconButton>
            }
          />
        </div>
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <AvatarStack people={board.members} total={board.member_count} size="xs" />
            <span className="truncate text-[13px] text-muted">
              {inTrash ? "Deleted " : "Updated "}
              <RelativeTime date={board.deleted_at ?? board.updated_at} />
            </span>
          </div>
          <RoleBadge role={board.role} />
        </div>
      </div>

      <Modal
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title="Rename board"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" form={`rename-${board.id}`} loading={pending}>
              Save name
            </Button>
          </>
        }
      >
        <form
          id={`rename-${board.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            run(() => updateBoardAction({ boardId: board.id, title }), "Board renamed.");
          }}
        >
          <Input
            label="Board name"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            error={error ?? undefined}
            data-autofocus
          />
        </form>
      </Modal>

      <Modal
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Move this board to Trash?"
        description={`“${board.title}” will disappear for everyone on it. You can restore it from Trash.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => run(() => deleteBoardAction({ boardId: board.id }), "Board moved to Trash.")}
            >
              Move to Trash
            </Button>
          </>
        }
      >
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <p className="text-sm text-muted">Members lose access until you restore it.</p>
        )}
      </Modal>

      <Modal
        open={dialog === "purge"}
        onClose={() => setDialog(null)}
        title="Delete this board forever?"
        description={`“${board.title}”, its comments and its history will be permanently removed. This cannot be undone.`}
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => run(() => purgeBoardAction({ boardId: board.id }), "Board permanently deleted.")}
            >
              Delete forever
            </Button>
          </>
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Modal>

      <Modal
        open={dialog === "leave"}
        onClose={() => setDialog(null)}
        title="Leave this board?"
        description={`You will lose access to “${board.title}” until its owner invites you again.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => run(() => leaveBoardAction({ boardId: board.id }), "You left the board.")}
            >
              Leave board
            </Button>
          </>
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Modal>
    </article>
  );
}
