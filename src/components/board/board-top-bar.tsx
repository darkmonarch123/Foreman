"use client";

import { ArrowLeft, Download, PanelRight, Redo2, Settings, Share2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ProfileMenu } from "@/components/app/profile-menu";
import { AvatarStack, type AvatarPerson } from "@/components/ui/avatar";
import { RoleBadge, StatusBadge, type SyncStatus } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Wordmark } from "@/components/ui/wordmark";
import type { BoardRole } from "@/lib/board/types";
import { boardTitleSchema } from "@/lib/boards/schemas";

interface BoardTopBarProps {
  boardId: string;
  title: string;
  role: BoardRole;
  status: SyncStatus;
  pendingCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRename: (title: string) => Promise<void>;
  onlineMembers: (AvatarPerson & { user_id: string })[];
  onShare: () => void;
  onExport: () => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
  currentUser: { first_name: string; last_name: string; username: string; avatar_url: string };
}

export function BoardTopBar({
  boardId,
  title,
  role,
  status,
  pendingCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRename,
  onlineMembers,
  onShare,
  onExport,
  onTogglePanel,
  panelOpen,
  currentUser,
}: BoardTopBarProps) {
  const isOwner = role === "OWNER";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setEditing(false);
      setError(null);
      return;
    }
    const parsed = boardTitleSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Give the board a name.");
      return;
    }
    if (parsed.data === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(parsed.data);
      setEditing(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The board couldn’t be renamed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
      <Tooltip label="Back to dashboard" side="bottom">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control hover:bg-ink/6"
        >
          <ArrowLeft className="size-[18px]" aria-hidden />
        </Link>
      </Tooltip>
      <Wordmark className="hidden shrink-0 text-sm md:inline-block" />
      <span className="mx-1 hidden h-6 w-px shrink-0 bg-line md:block" aria-hidden />

      <div className="relative flex min-w-0 items-center gap-2">
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
          >
            <label htmlFor="board-title" className="sr-only">
              Board name
            </label>
            <input
              id="board-title"
              autoFocus
              value={draft}
              maxLength={120}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "board-title-error" : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  cancelled.current = true;
                  event.currentTarget.blur();
                }
              }}
              className="h-9 w-64 max-w-[40vw] rounded-lg border border-focus px-2.5 text-[15px] font-medium outline-none ring-3 ring-focus/20"
            />
            {error ? (
              <p
                id="board-title-error"
                role="alert"
                className="absolute left-0 top-11 z-10 rounded-lg bg-error px-2.5 py-1.5 text-xs text-white shadow-soft"
              >
                {error}
              </p>
            ) : null}
          </form>
        ) : isOwner ? (
          <Tooltip label="Rename board" side="bottom">
            <button
              type="button"
              onClick={() => {
                setDraft(title);
                setError(null);
                setEditing(true);
              }}
              className="max-w-[26vw] truncate rounded-lg px-2 py-1.5 text-[15px] font-medium hover:bg-ink/6"
            >
              <span className="sr-only">Board name: </span>
              {title}
            </button>
          </Tooltip>
        ) : (
          <h1 className="max-w-[26vw] truncate px-2 text-[15px] font-medium">{title}</h1>
        )}
        <RoleBadge role={role} className="hidden shrink-0 sm:inline-flex" />
      </div>

      <div role="group" aria-label="History" className="ml-1 flex shrink-0 items-center">
        <Tooltip label="Undo" shortcut="Ctrl Z" side="bottom">
          <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Redo" shortcut="Ctrl Shift Z" side="bottom">
          <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
      </div>

      <div className="ml-1 flex shrink-0 items-center gap-2">
        <StatusBadge status={status} />
        {pendingCount > 0 && status !== "saving" ? (
          <span className="hidden text-xs text-muted lg:inline">
            {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {onlineMembers.length > 0 ? (
          <button
            type="button"
            onClick={onTogglePanel}
            className="hidden rounded-full p-0.5 hover:bg-ink/6 sm:inline-flex"
            aria-label={`${onlineMembers.length} ${onlineMembers.length === 1 ? "person" : "people"} online. Open the people panel`}
          >
            <AvatarStack people={onlineMembers} max={4} />
          </button>
        ) : null}
        {isOwner ? (
          <>
            <Button variant="secondary" size="sm" onClick={onShare} className="h-9">
              <Share2 className="size-4" aria-hidden />
              Share
            </Button>
            <Tooltip label="Board settings" side="bottom">
              <Link
                href={`/boards/${boardId}/settings`}
                aria-label="Board settings"
                className="hidden size-10 items-center justify-center rounded-control hover:bg-ink/6 sm:inline-flex"
              >
                <Settings className="size-[18px]" aria-hidden />
              </Link>
            </Tooltip>
          </>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onExport} className="h-9">
          <Download className="size-4" aria-hidden />
          <span className="hidden sm:inline">Export</span>
          <span className="sm:hidden sr-only">Export</span>
        </Button>
        <Tooltip label={panelOpen ? "Hide panel" : "Show panel"} side="bottom">
          <IconButton label={panelOpen ? "Hide panel" : "Show panel"} aria-pressed={panelOpen} onClick={onTogglePanel}>
            <PanelRight className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
        <ProfileMenu profile={currentUser} />
      </div>
    </header>
  );
}
