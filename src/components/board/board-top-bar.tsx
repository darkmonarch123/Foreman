"use client";

import { ArrowLeft, Download, MessageSquare, PanelRight, Redo2, Settings, Share2, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ProfileMenu } from "@/components/app/profile-menu";
import { AvatarStack, type AvatarPerson } from "@/components/ui/avatar";
import { RoleBadge, StatusBadge, type SyncStatus } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Wordmark } from "@/components/ui/wordmark";
import { MoreMenu, type MoreActions } from "./board-toolbar";
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
  assistantAvailable?: boolean;
  assistantOpen?: boolean;
  onToggleAssistant?: () => void;
  onComments?: () => void;
  commentsOpen?: boolean;
  more?: MoreActions;
  currentUser: {
    first_name: string;
    last_name: string;
    username: string;
    avatar_url: string;
    email?: string;
    theme_preference?: "system" | "light" | "dark";
  };
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
  assistantAvailable = false,
  assistantOpen = false,
  onToggleAssistant,
  onComments,
  commentsOpen = false,
  more,
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
    // Phone: a compact bar floating over the board, below the status bar / notch.
    // Tablet and up: a full-width bar above the board.
    <header className="absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex h-14 shrink-0 items-center gap-1 rounded-sheet border border-line bg-elevated px-1.5 shadow-soft tablet:static tablet:gap-2 tablet:rounded-none tablet:border-0 tablet:border-b tablet:bg-surface tablet:px-3 tablet:shadow-none">
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
                className="absolute left-0 top-11 z-10 rounded-lg bg-danger px-2.5 py-1.5 text-xs text-on-danger shadow-soft"
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
            <Button variant="secondary" size="sm" onClick={onShare} className="h-9 max-tablet:hidden">
              <Share2 className="size-4" aria-hidden />
              Share
            </Button>
            <Tooltip label="Board settings" side="bottom">
              <Link
                href={`/boards/${boardId}/settings`}
                aria-label="Board settings"
                className="hidden size-10 items-center justify-center rounded-control hover:bg-ink/6 tablet:inline-flex xl:hidden"
              >
                <Settings className="size-[18px]" aria-hidden />
              </Link>
            </Tooltip>
          </>
        ) : null}
        {onComments ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onComments}
            aria-pressed={commentsOpen}
            className="h-9 max-tablet:hidden"
          >
            <MessageSquare className="size-4" aria-hidden />
            <span className="hidden lg:inline">Comments</span>
            <span className="sr-only lg:hidden">Comments</span>
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onExport} className="h-9 max-tablet:hidden">
          <Download className="size-4" aria-hidden />
          <span className="hidden lg:inline">Export</span>
          <span className="sr-only lg:hidden">Export</span>
        </Button>
        {assistantAvailable ? (
          <Tooltip label="Foreman Assistant" shortcut="F" side="bottom">
            <Button
              variant="secondary"
              size="sm"
              onClick={onToggleAssistant}
              aria-pressed={assistantOpen}
              aria-keyshortcuts="F"
              className="h-9 max-tablet:hidden"
            >
              <Sparkles className="size-4" aria-hidden />
              <span className="hidden lg:inline">Foreman Assistant</span>
              <span className="sr-only lg:hidden">Foreman Assistant</span>
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip label={panelOpen ? "Hide panel" : "Show panel"} side="bottom">
          <IconButton
            label={panelOpen ? "Hide panel" : "Show panel"}
            aria-pressed={panelOpen}
            onClick={onTogglePanel}
            className="max-tablet:hidden"
          >
            <PanelRight className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
        {more ? (
          <div className="max-tablet:hidden">
            <MoreMenu {...more} />
          </div>
        ) : null}
        <ProfileMenu profile={currentUser} />
      </div>
    </header>
  );
}
