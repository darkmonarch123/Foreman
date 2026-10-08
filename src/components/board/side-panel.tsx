"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Copy,
  History,
  ListTree,
  MessageSquare,
  MoveUpRight,
  PenLine,
  Pencil,
  Square,
  StickyNote,
  Trash2,
  Type,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Avatar, personName } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { describeActivity } from "@/lib/board/activity-text";
import { describeObject, supportsText } from "@/lib/board/defaults";
import type { ActivityItem, BoardComment, Member } from "@/lib/board/services";
import type { CanvasObject, CanvasObjectType } from "@/lib/board/types";
import { commentSchema } from "@/lib/boards/schemas";
import { cn } from "@/lib/cn";

export type PanelTab = "people" | "activity" | "comments" | "outline";

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

interface PeoplePanelProps {
  members: Member[];
  onlineIds: ReadonlySet<string>;
  currentUserId: string;
  isOwner: boolean;
  onInvite: () => void;
}

export function PeoplePanel({ members, onlineIds, currentUserId, isOwner, onInvite }: PeoplePanelProps) {
  const online = members.filter((member) => onlineIds.has(member.user_id));
  const offline = members.filter((member) => !onlineIds.has(member.user_id));
  const othersOnline = online.filter((member) => member.user_id !== currentUserId).length;

  const row = (member: Member, isOnline: boolean) => (
    <li key={member.user_id} className="flex items-center gap-3 py-2">
      <Avatar person={member} online={isOnline} decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {personName(member)}
          {member.user_id === currentUserId ? <span className="font-normal text-muted"> (you)</span> : null}
        </p>
        <p className="truncate text-[13px] text-muted">@{member.username}</p>
      </div>
      <RoleBadge role={member.role} />
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      {isOwner ? (
        <Button variant="secondary" onClick={onInvite} className="w-full">
          <UserPlus className="size-4" aria-hidden />
          Invite people
        </Button>
      ) : null}

      <section aria-label="Online now">
        <h3 className="mb-1 text-[13px] font-medium text-muted">Online now ({online.length})</h3>
        <ul>{online.map((member) => row(member, true))}</ul>
        {othersOnline === 0 ? (
          <p className="mt-1 rounded-control bg-warm px-3 py-2.5 text-[13px] leading-snug text-muted">
            No one else is on the board right now.
          </p>
        ) : null}
      </section>

      {offline.length > 0 ? (
        <section aria-label="Offline">
          <h3 className="mb-1 text-[13px] font-medium text-muted">Offline ({offline.length})</h3>
          <ul>{offline.map((member) => row(member, false))}</ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

interface ActivityPanelProps {
  items: ActivityItem[] | null;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function ActivityPanel({ items, error, hasMore, loadingMore, onLoadMore, onRetry }: ActivityPanelProps) {
  if (error && !items) {
    return (
      <Notice tone="error">
        {error}{" "}
        <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!items) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading activity">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={<History className="size-5" />}
        title="No activity yet"
        description="Changes to this board will be listed here as they happen."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4" aria-label="Board activity, newest first">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3">
            {item.actor ? (
              <Avatar person={item.actor} size="xs" decorative className="mt-0.5" />
            ) : (
              <span className="mt-0.5 size-6 shrink-0 rounded-full bg-line" aria-hidden />
            )}
            <p className="min-w-0 flex-1 text-sm leading-snug">
              <span className="font-medium">{item.actor ? personName(item.actor) : "A former member"}</span>{" "}
              {describeActivity(item)}
              <RelativeTime date={item.created_at} className="mt-0.5 block text-xs text-muted" />
            </p>
          </li>
        ))}
      </ol>
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore} className="self-center">
          Show older activity
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

interface CommentsPanelProps {
  comments: BoardComment[] | null;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  canComment: boolean;
  currentUserId: string;
  /** The object a new comment will be attached to, if any. */
  target: CanvasObject | null;
  onClearTarget: () => void;
  objectsById: ReadonlyMap<string, CanvasObject>;
  onFocusObject: (id: string) => void;
  onAdd: (body: string, objectId: string | null) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function CommentItem({
  comment,
  own,
  anchor,
  onFocusObject,
  onEdit,
  onDelete,
}: {
  comment: BoardComment;
  own: boolean;
  anchor: CanvasObject | null;
  onFocusObject: (id: string) => void;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = comment.author ? personName(comment.author) : "A former member";

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-control border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        {comment.author ? <Avatar person={comment.author} size="xs" decorative className="mt-0.5" /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">
            <span className="font-medium">{name}</span>{" "}
            <RelativeTime date={comment.created_at} className="text-muted" />
            {comment.edited_at ? <span className="text-muted"> (edited)</span> : null}
          </p>
          {anchor ? (
            <button
              type="button"
              onClick={() => onFocusObject(anchor.id)}
              className="mt-1 max-w-full truncate rounded-full bg-yellow-tint px-2 py-0.5 text-left text-xs text-ink hover:bg-yellow"
            >
              On {describeObject(anchor)}
            </button>
          ) : comment.object_id ? (
            <span className="mt-1 inline-block rounded-full bg-warm px-2 py-0.5 text-xs text-muted">
              On an item that was deleted
            </span>
          ) : null}

          {editing ? (
            <form
              className="mt-2 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = commentSchema.safeParse(draft);
                if (!parsed.success) {
                  setError(parsed.error.issues[0]?.message ?? "Write a comment first.");
                  return;
                }
                void run(
                  () => onEdit(comment.id, parsed.data),
                  () => setEditing(false),
                );
              }}
            >
              <label className="sr-only" htmlFor={`edit-${comment.id}`}>
                Edit comment
              </label>
              <textarea
                id={`edit-${comment.id}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full resize-y rounded-lg border border-line p-2 text-sm focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(comment.body);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            // Rendered as text. Comment bodies are never treated as HTML.
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-snug [overflow-wrap:anywhere]">{comment.body}</p>
          )}
          {error ? (
            <p role="alert" className="mt-1.5 text-[13px] text-error">
              {error}
            </p>
          ) : null}
        </div>
        {own && !editing ? (
          <div className="-mr-1 -mt-1 flex shrink-0">
            <IconButton label="Edit comment" size="sm" disabled={busy} onClick={() => setEditing(true)}>
              <PenLine className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton
              label="Delete comment"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => onDelete(comment.id))}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function CommentsPanel({
  comments,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  canComment,
  currentUserId,
  target,
  onClearTarget,
  objectsById,
  onFocusObject,
  onAdd,
  onEdit,
  onDelete,
}: CommentsPanelProps) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: Pick<FormEvent, "preventDefault">) {
    event.preventDefault();
    const parsed = commentSchema.safeParse(body);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Write a comment first.");
      return;
    }
    setPosting(true);
    setFormError(null);
    try {
      await onAdd(parsed.data, target?.id ?? null);
      setBody("");
      onClearTarget();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Your comment couldn’t be posted.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canComment ? (
        <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
          <label htmlFor="new-comment" className="text-sm font-medium">
            Add a comment
          </label>
          {target ? (
            <p className="flex items-center gap-1.5 self-start rounded-full bg-yellow-tint py-0.5 pl-2.5 pr-1 text-xs">
              <span className="max-w-52 truncate">On {describeObject(target)}</span>
              <button
                type="button"
                onClick={onClearTarget}
                aria-label="Comment on the whole board instead"
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-yellow"
              >
                <X className="size-3" aria-hidden />
              </button>
            </p>
          ) : null}
          <textarea
            id="new-comment"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event);
            }}
            maxLength={2000}
            rows={3}
            placeholder={target ? "Say something about this item" : "Say something about this board"}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "new-comment-error" : undefined}
            className="w-full resize-y rounded-control border border-line bg-surface p-3 text-sm placeholder:text-muted/70 hover:border-line-strong focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
          />
          {formError ? (
            <p id="new-comment-error" role="alert" className="text-[13px] text-error">
              {formError}
            </p>
          ) : null}
          <Button type="submit" size="sm" loading={posting} loadingLabel="Posting" className="self-end">
            Post comment
          </Button>
        </form>
      ) : (
        <Notice tone="info">Viewers can read comments on this board but can’t add them.</Notice>
      )}

      {error && !comments ? (
        <Notice tone="error">
          {error}{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>
            Try again
          </button>
        </Notice>
      ) : !comments ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading comments">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : comments.length === 0 ? (
        <EmptyState
          compact
          icon={<MessageSquare className="size-5" />}
          title="No comments yet"
          description={
            canComment ? "Start the conversation, or use the Comment tool to attach a note to an item." : undefined
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2.5" aria-label="Comments, newest first">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                own={comment.author_id === currentUserId}
                anchor={comment.object_id ? (objectsById.get(comment.object_id) ?? null) : null}
                onFocusObject={onFocusObject}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
          {hasMore ? (
            <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore} className="self-center">
              Show older comments
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline: the keyboard and screen-reader route to everything on the canvas
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<CanvasObjectType, LucideIcon> = {
  STICKY_NOTE: StickyNote,
  TEXT: Type,
  RECTANGLE: Square,
  CIRCLE: Circle,
  ARROW: MoveUpRight,
  DRAWING: Pencil,
};

interface OutlinePanelProps {
  objects: CanvasObject[];
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
}

const NUDGE = 20;

export function OutlinePanel({
  objects,
  selectedId,
  canEdit,
  onSelect,
  onEditText,
  onDuplicate,
  onDelete,
  onNudge,
}: OutlinePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (objects.length === 0) {
    return (
      <EmptyState
        compact
        icon={<ListTree className="size-5" />}
        title="This board is empty"
        description={
          canEdit
            ? "Press N to add a sticky note, or pick a tool from the rail on the left."
            : "Nothing has been added yet."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-snug text-muted">
        Every item on the canvas, in stacking order. Select one to find it on the board
        {canEdit ? "; the actions below it work without a mouse." : "."}
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="Board items">
        {objects.map((object) => {
          const Icon = TYPE_ICONS[object.type];
          const selected = object.id === selectedId;
          const label = describeObject(object);
          return (
            <li
              key={object.id}
              className={cn("rounded-control border", selected ? "border-ink bg-surface" : "border-transparent")}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(object.id)}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm hover:bg-ink/6"
              >
                <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>

              {selected && canEdit ? (
                <div className="border-t border-line px-2.5 py-2.5">
                  {editingId === object.id ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onEditText(object.id, draft);
                        setEditingId(null);
                      }}
                    >
                      <label htmlFor={`outline-text-${object.id}`} className="text-[13px] font-medium">
                        Text
                      </label>
                      <textarea
                        id={`outline-text-${object.id}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={5000}
                        rows={3}
                        autoFocus
                        className="w-full resize-y rounded-lg border border-line p-2 text-sm focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          Save text
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Actions for ${label}`}>
                      {supportsText(object.type) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setDraft(object.props.text ?? "");
                            setEditingId(object.id);
                          }}
                        >
                          <PenLine className="size-3.5" aria-hidden />
                          Edit text
                        </Button>
                      ) : null}
                      <IconButton label="Duplicate" size="sm" onClick={() => onDuplicate(object.id)}>
                        <Copy className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton label="Delete" size="sm" className="text-error" onClick={() => onDelete(object.id)}>
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                      <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px bg-line" />
                      <IconButton label="Move left" size="sm" onClick={() => onNudge(object.id, -NUDGE, 0)}>
                        <ArrowLeft className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton label="Move up" size="sm" onClick={() => onNudge(object.id, 0, -NUDGE)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton label="Move down" size="sm" onClick={() => onNudge(object.id, 0, NUDGE)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton label="Move right" size="sm" onClick={() => onNudge(object.id, NUDGE, 0)}>
                        <ArrowRight className="size-4" aria-hidden />
                      </IconButton>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel frame
// ---------------------------------------------------------------------------

interface SidePanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
  commentCount: number;
  children: React.ReactNode;
}

export function SidePanel({ tab, onTabChange, onClose, commentCount, children }: SidePanelProps) {
  return (
    <aside
      aria-label="Collaboration panel"
      className="flex h-full w-[22rem] max-w-[92vw] shrink-0 flex-col border-l border-line bg-warm"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-sm font-medium">Board panel</h2>
        <IconButton label="Close panel" size="sm" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      <Tabs
        label="Board panel"
        tabs={[
          { id: "people", label: "People" },
          { id: "activity", label: "Activity" },
          { id: "comments", label: "Comments", count: commentCount || undefined },
          { id: "outline", label: "Outline" },
        ]}
        value={tab}
        onChange={(id) => onTabChange(id as PanelTab)}
        className="flex min-h-0 flex-1 flex-col px-2 pt-1"
        panelClassName="min-h-0 flex-1 overflow-y-auto px-2 py-4"
      >
        {children}
      </Tabs>
    </aside>
  );
}
