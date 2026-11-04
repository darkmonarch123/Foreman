"use client";

import { Check, Eye, EyeOff, Pencil, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ASSISTANT_ACTION_LABELS,
  ASSISTANT_ACTIONS,
  MAX_GUIDANCE,
  MAX_PROPOSAL_TEXT,
  type AssistantAction,
  type AssistantAcceptResult,
  type AssistantProposalRecord,
  type AssistantServices,
  type EvidenceRef,
  type ProposalDraft,
} from "@/lib/assistant/types";
import type { CanvasObject, ServerOperation } from "@/lib/board/types";
import { cn } from "@/lib/cn";
import { errorMessage, toAppError } from "@/lib/errors";
import { startTimer } from "@/lib/perf/client";

/** A request from outside the panel (the toolbar, context menu or a shortcut) to run something. */
export interface AssistantIntent {
  /** Changes on every request, so the same action can be requested twice. */
  nonce: number;
  action: AssistantAction;
  context: "board" | "object";
}

interface AssistantPanelProps {
  services: AssistantServices;
  /** For timing only. */
  boardId?: string;
  canEdit: boolean;
  online: boolean;
  /** Live board objects, by id, used to spot stale proposals before the server is asked. */
  objectsById: ReadonlyMap<string, CanvasObject>;
  selected: { id: string; label: string } | null;
  intent: AssistantIntent | null;
  onClose: () => void;
  onPreview: (draft: ProposalDraft | null) => void;
  onFocusObject: (id: string) => void;
  onApplied: (operation: ServerOperation) => void;
  onUndoApplied: (objectId: string) => boolean;
  onAnnounce: (message: string) => void;
}

type Phase = "loading" | "idle" | "running";

const LABEL_TEXT = { fact: "Fact", inference: "Inference", suggestion: "Suggestion" } as const;
const LABEL_STYLE = {
  fact: "bg-success-soft text-success",
  inference: "bg-warning-soft text-warning",
  suggestion: "bg-sky-tint text-ink",
} as const;

export type StaleKind = "changed" | "deleted";

/** Compares the versions a finding was based on with the live board. The server checks again on accept. */
export function clientStaleness(
  record: AssistantProposalRecord,
  objectsById: ReadonlyMap<string, CanvasObject>,
): StaleKind | null {
  if (record.status === "stale") return "changed";
  if (!record.proposal) return null;
  const refs: { id: string; version: number }[] = record.evidence.map((e) => ({ id: e.object_id, version: e.version }));
  if (record.target_object_id && record.target_object_version != null) {
    refs.push({ id: record.target_object_id, version: record.target_object_version });
  }
  for (const ref of refs) {
    const live = objectsById.get(ref.id);
    if (!live || live.deleted) return "deleted";
    if (live.version !== ref.version) return "changed";
  }
  return null;
}

function currentDraft(record: AssistantProposalRecord): ProposalDraft | null {
  return record.edited_proposal ?? record.proposal;
}

function describeDraft(draft: ProposalDraft): string {
  const type = draft.object.type.replaceAll("_", " ").toLowerCase();
  return `New ${type}`;
}

export function AssistantPanel({
  services,
  boardId,
  canEdit,
  online,
  objectsById,
  selected,
  intent,
  onClose,
  onPreview,
  onFocusObject,
  onApplied,
  onUndoApplied,
  onAnnounce,
}: AssistantPanelProps) {
  const [action, setAction] = useState<AssistantAction>("find_planning_gaps");
  const [contextKind, setContextKind] = useState<"board" | "object">("board");
  const [guidance, setGuidance] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<AssistantProposalRecord[]>([]);
  const [applied, setApplied] = useState<Map<string, string>>(() => new Map()); // proposal id -> object id
  const [undone, setUndone] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [meta, setMeta] = useState<{ exclusions: string[]; guidanceIgnored: boolean; truncated: boolean } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Map<string, string>>(() => new Map());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const handledIntent = useRef<number | null>(null);
  /** Set once a run starts, so the initial list of earlier proposals never overwrites its results. */
  const runStarted = useRef(false);

  const setPreviewing = useCallback(
    (id: string | null, draft: ProposalDraft | null) => {
      setPreviewId(id);
      onPreview(draft);
    },
    [onPreview],
  );

  // Focus moves into the panel when it opens and returns to where it came from when it closes.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const restore = opener.current;
    return () => {
      onPreview(null);
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [onPreview]);

  // Earlier proposals for this board (pending or stale) come back when the panel opens.
  useEffect(() => {
    let cancelled = false;
    services.list().then(
      (records) => {
        if (cancelled || runStarted.current) return;
        setItems(records.filter((record) => record.status === "pending" || record.status === "stale"));
        setPhase("idle");
      },
      (caught: unknown) => {
        if (cancelled || runStarted.current) return;
        setError(errorMessage(caught));
        setPhase("idle");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [services]);

  const run = useCallback(
    async (nextAction: AssistantAction, nextContext: "board" | "object") => {
      setError(null);
      setNotices(new Map());
      setEditingId(null);
      setPreviewing(null, null);
      if (nextContext === "object" && !selected) {
        setError("Select one item on the board first.");
        return;
      }
      runStarted.current = true;
      setPhase("running");
      onAnnounce(`Foreman Assistant: ${ASSISTANT_ACTION_LABELS[nextAction].label} is running`);
      const timer = startTimer("assistant_run", { boardId });
      try {
        const result = await services.run({
          action: nextAction,
          context: nextContext === "object" && selected ? { kind: "object", objectId: selected.id } : { kind: "board" },
          ...(guidance.trim() ? { guidance: guidance.trim() } : {}),
        });
        setItems(result.proposals);
        setMeta({
          exclusions: result.exclusions,
          guidanceIgnored: result.guidanceIgnored,
          truncated: result.truncated,
        });
        setHasRun(true);
        timer.endAfterPaint();
        onAnnounce(
          result.proposals.length === 0
            ? "Foreman Assistant finished. No high-confidence planning gaps found."
            : `Foreman Assistant finished. ${result.proposals.length} ${result.proposals.length === 1 ? "finding" : "findings"}.`,
        );
      } catch (caught) {
        timer.end("error", toAppError(caught).code);
        const message = errorMessage(caught);
        setError(message);
        onAnnounce(`Foreman Assistant could not finish. ${message}`);
      } finally {
        setPhase("idle");
      }
    },
    [services, selected, guidance, onAnnounce, setPreviewing, boardId],
  );

  // A request from the toolbar, context menu or shortcut. Handled once per nonce.
  useEffect(() => {
    if (!intent || handledIntent.current === intent.nonce) return;
    handledIntent.current = intent.nonce;
    setAction(intent.action);
    setContextKind(intent.context);
    void run(intent.action, intent.context);
  }, [intent, run]);

  // A selection that goes away cannot be the context any more.
  useEffect(() => {
    if (!selected && contextKind === "object") setContextKind("board");
  }, [selected, contextKind]);

  const viewerBlocked = !canEdit && action === "propose_plan";

  async function accept(record: AssistantProposalRecord) {
    setBusyId(record.id);
    setNotices((current) => {
      const next = new Map(current);
      next.delete(record.id);
      return next;
    });
    const timer = startTimer("proposal_accept", { boardId });
    try {
      const result: AssistantAcceptResult = await services.accept(record.id);
      timer.endAfterPaint(
        result.status === "applied" || result.status === "already_applied"
          ? "ok"
          : result.status === "stale"
            ? "stale"
            : result.status === "failed"
              ? "error"
              : "rejected",
        result.status === "failed" ? result.code : undefined,
      );
      setPreviewing(null, null);
      switch (result.status) {
        case "applied":
        case "already_applied":
          onApplied(result.operation);
          setApplied((current) => new Map(current).set(record.id, result.operation.object_id));
          setItems((current) => current.map((entry) => (entry.id === record.id ? result.proposal : entry)));
          onAnnounce("Proposal accepted and added to the board. You can undo it.");
          break;
        case "stale":
          setItems((current) => current.map((entry) => (entry.id === record.id ? result.proposal : entry)));
          onAnnounce("This proposal is out of date and was not applied.");
          break;
        case "failed":
          setNotices((current) =>
            new Map(current).set(
              record.id,
              result.code === "RATE_LIMITED"
                ? "You're accepting too quickly. Wait a moment and try again."
                : "The change could not be applied. Nothing was changed on the board.",
            ),
          );
          onAnnounce("The proposal could not be applied.");
          break;
        default:
          setItems((current) => current.map((entry) => (entry.id === record.id ? result.proposal : entry)));
          setNotices((current) =>
            new Map(current).set(record.id, "This proposal is no longer available, so it was not applied."),
          );
      }
    } catch (caught) {
      const code = toAppError(caught).code;
      timer.end("error", code);
      const message =
        code === "BOARD_ACCESS_DENIED"
          ? "You no longer have permission to apply changes on this board."
          : errorMessage(caught);
      setNotices((current) => new Map(current).set(record.id, message));
      onAnnounce(message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(record: AssistantProposalRecord) {
    setBusyId(record.id);
    try {
      await services.reject(record.id);
      if (previewId === record.id) setPreviewing(null, null);
      setItems((current) => current.filter((entry) => entry.id !== record.id));
      onAnnounce("Proposal rejected.");
      headingRef.current?.focus(); // the card that had focus is gone
    } catch (caught) {
      setNotices((current) => new Map(current).set(record.id, errorMessage(caught)));
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(record: AssistantProposalRecord, text: string) {
    const draft = currentDraft(record);
    if (!draft) return;
    setBusyId(record.id);
    try {
      const updated = await services.edit(record.id, {
        kind: "create_object",
        object: { ...draft.object, props: { ...draft.object.props, text } },
      });
      setItems((current) => current.map((entry) => (entry.id === record.id ? updated : entry)));
      setEditingId(null);
      if (previewId === record.id) onPreview(currentDraft(updated));
      onAnnounce("Proposal text updated.");
    } catch (caught) {
      setNotices((current) => new Map(current).set(record.id, errorMessage(caught)));
    } finally {
      setBusyId(null);
    }
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    if (editingId) {
      setEditingId(null);
      return;
    }
    onClose();
  }

  const explainOnly = items.length > 0 && items.every((record) => record.proposal === null);

  return (
    <aside
      aria-label="Foreman Assistant"
      onKeyDown={onPanelKeyDown}
      className="flex h-[88dvh] w-full shrink-0 flex-col bg-canvas pb-[env(safe-area-inset-bottom)] tablet:h-full tablet:w-[24rem] tablet:max-w-[92vw] tablet:border-l tablet:border-line tablet:pb-0"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-sm font-medium outline-none">
          <Sparkles className="size-4" aria-hidden />
          Foreman Assistant
        </h2>
        <IconButton label="Close Assistant" size="sm" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        <p className="text-xs leading-relaxed text-muted">
          Rule-based and private: it reads this board on the server and sends nothing anywhere else. It only suggests.
          Nothing changes until you accept a proposal.
        </p>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(action, contextKind);
          }}
        >
          <Select
            label="What should it do?"
            value={action}
            onChange={(event) => setAction(event.target.value as AssistantAction)}
            hint={ASSISTANT_ACTION_LABELS[action].description}
          >
            {ASSISTANT_ACTIONS.map((id) => (
              <option key={id} value={id} disabled={!canEdit && id === "propose_plan"}>
                {ASSISTANT_ACTION_LABELS[id].label}
              </option>
            ))}
          </Select>
          <Select
            label="Look at"
            value={contextKind}
            onChange={(event) => setContextKind(event.target.value as "board" | "object")}
            hint={
              contextKind === "object" && selected
                ? `Selected: ${selected.label}`
                : selected
                  ? undefined
                  : "Select one item on the board to look at just that item."
            }
          >
            <option value="board">Entire board</option>
            <option value="object" disabled={!selected}>
              Selected object
            </option>
          </Select>
          <Input
            label="Guidance (optional)"
            value={guidance}
            maxLength={MAX_GUIDANCE}
            placeholder="For example: do not include billing"
            onChange={(event) => setGuidance(event.target.value)}
          />
          <Button type="submit" loading={phase === "running"} disabled={phase !== "idle" || viewerBlocked}>
            Run
          </Button>
          {!canEdit ? (
            <p className="text-xs text-muted">
              You have view-only access. You can explain the board and find gaps, but not propose or apply changes.
            </p>
          ) : null}
        </form>

        {error ? (
          <Notice tone="error" className="mt-4">
            {error}
          </Notice>
        ) : null}
        {meta?.guidanceIgnored ? (
          <Notice tone="info" className="mt-4">
            Guidance can only leave things out, like “do not include billing”. It was not applied.
          </Notice>
        ) : null}
        {meta && meta.exclusions.length > 0 ? (
          <p className="mt-4 text-xs text-muted">Leaving out: {meta.exclusions.join(", ")}</p>
        ) : null}
        {meta?.truncated ? <p className="mt-2 text-xs text-muted">Showing the 10 most confident findings.</p> : null}

        <div className="mt-5" aria-busy={phase !== "idle"}>
          {phase === "loading" || phase === "running" ? (
            <div role="status" className="flex flex-col gap-3">
              <span className="sr-only">{phase === "running" ? "Analyzing the board" : "Loading"}</span>
              <Skeleton className="h-28 w-full rounded-card" />
              <Skeleton className="h-28 w-full rounded-card" />
            </div>
          ) : items.length === 0 ? (
            hasRun && !error ? (
              <p className="rounded-card border border-line bg-surface px-4 py-5 text-sm">
                No high-confidence planning gaps found.
              </p>
            ) : null
          ) : (
            <>
              {explainOnly ? null : (
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  {items.length} {items.length === 1 ? "finding" : "findings"}
                </h3>
              )}
              <ul className="flex flex-col gap-3">
                {items.map((record) => (
                  <ProposalCard
                    key={record.id}
                    record={record}
                    canEdit={canEdit}
                    online={online}
                    stale={clientStaleness(record, objectsById)}
                    busy={busyId === record.id}
                    previewing={previewId === record.id}
                    editing={editingId === record.id}
                    appliedObjectId={applied.get(record.id) ?? null}
                    undone={undone.has(record.id)}
                    notice={notices.get(record.id) ?? null}
                    objectsById={objectsById}
                    onViewEvidence={onFocusObject}
                    onTogglePreview={() => {
                      const draft = currentDraft(record);
                      if (previewId === record.id) setPreviewing(null, null);
                      else if (draft) setPreviewing(record.id, draft);
                      if (previewId !== record.id) void services.markViewed(record.id).catch(() => undefined);
                    }}
                    onEdit={() => setEditingId(record.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(text) => void saveEdit(record, text)}
                    onAccept={() => void accept(record)}
                    onReject={() => void reject(record)}
                    onUndo={(objectId) => {
                      if (onUndoApplied(objectId)) {
                        setUndone((current) => new Set(current).add(record.id));
                        onAnnounce("Proposal undone. The note was removed from the board.");
                      }
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

interface ProposalCardProps {
  record: AssistantProposalRecord;
  canEdit: boolean;
  online: boolean;
  stale: StaleKind | null;
  busy: boolean;
  previewing: boolean;
  editing: boolean;
  appliedObjectId: string | null;
  undone: boolean;
  notice: string | null;
  objectsById: ReadonlyMap<string, CanvasObject>;
  onViewEvidence: (id: string) => void;
  onTogglePreview: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: (objectId: string) => void;
}

function ProposalCard({
  record,
  canEdit,
  online,
  stale,
  busy,
  previewing,
  editing,
  appliedObjectId,
  undone,
  notice,
  objectsById,
  onViewEvidence,
  onTogglePreview,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onAccept,
  onReject,
  onUndo,
}: ProposalCardProps) {
  const draft = currentDraft(record);
  const cardRef = useRef<HTMLLIElement>(null);
  const wasEditing = useRef(false);
  // When editing ends, focus goes back to the Edit button instead of being lost with the field.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      cardRef.current?.querySelector<HTMLElement>("[data-edit-button]")?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);
  const isApplied = record.status === "accepted" || record.status === "edited_accepted" || appliedObjectId !== null;
  const objectId = appliedObjectId ?? record.applied_operation_id;
  const wasUndone = useRef(undone);
  useEffect(() => {
    if (!wasUndone.current && undone) cardRef.current?.focus(); // the Undo button just disappeared
    wasUndone.current = undone;
  }, [undone]);
  const wasApplied = useRef(isApplied);
  // The Accept button disappears once applied, so focus moves to the card (or its Undo button) instead of being lost.
  useEffect(() => {
    if (!wasApplied.current && isApplied) {
      const target = cardRef.current?.querySelector<HTMLElement>("[data-undo-button]") ?? cardRef.current;
      target?.focus();
    }
    wasApplied.current = isApplied;
  }, [isApplied]);
  const [text, setText] = useState(draft?.object.props.text ?? "");
  const percent = Math.round(record.confidence * 100);
  const titleId = `finding-${record.id}`;
  const textLimitError =
    text.length > MAX_PROPOSAL_TEXT ? `Keep the text under ${MAX_PROPOSAL_TEXT} characters.` : undefined;

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        "rounded-card border bg-surface p-4 outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        stale ? "border-warning/50" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", LABEL_STYLE[record.label])}>
          {LABEL_TEXT[record.label]}
        </span>
        <span className="text-xs text-muted">Confidence {percent}%</span>
        {record.status === "edited_accepted" || record.edited_proposal ? (
          <span className="text-xs text-muted">Edited</span>
        ) : null}
      </div>
      <h4 id={titleId} className="mt-2 text-[15px] font-medium leading-snug">
        {record.title}
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-ink/80">{record.explanation}</p>

      {record.evidence.length > 0 ? (
        <div className="mt-3">
          <h5 className="text-xs font-medium text-muted">Evidence</h5>
          <ul className="mt-1 flex flex-col gap-1.5">
            {record.evidence.map((item) => (
              <EvidenceRow
                key={item.object_id}
                item={item}
                missing={!objectsById.get(item.object_id) || objectsById.get(item.object_id)!.deleted}
                onView={() => onViewEvidence(item.object_id)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {draft ? (
        <div className="mt-3 rounded-control border border-dashed border-line-strong bg-warm px-3 py-2.5">
          <p className="text-xs font-medium text-muted">What would change</p>
          <p className="mt-0.5 text-sm">
            {describeDraft(draft)}
            {draft.object.props.text ? (
              <>
                : <span data-testid="proposal-text">{draft.object.props.text}</span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {editing && draft ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            label="Proposed text"
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
            error={textLimitError}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || text.trim().length === 0 || Boolean(textLimitError)}
              onClick={() => onSaveEdit(text.trim())}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {stale && !isApplied ? (
        <Notice tone="warning" className="mt-3">
          {stale === "deleted"
            ? "An item this is based on was deleted, so it can’t be applied. Run the analysis again."
            : "The board changed since this was suggested, so it can’t be applied. Run the analysis again."}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="warning" className="mt-3">
          {notice}
        </Notice>
      ) : null}

      {draft ? (
        isApplied ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <Check className="size-4" aria-hidden />
              {undone ? "Undone" : "Added to the board"}
            </span>
            {!undone && objectId && canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => onUndo(objectId)} data-undo-button>
                <Undo2 className="size-4" aria-hidden />
                Undo this
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" aria-pressed={previewing} onClick={onTogglePreview}>
              {previewing ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {previewing ? "Hide preview" : "Preview on board"}
            </Button>
            {canEdit ? (
              <>
                {draft.object.props.text !== undefined && !stale ? (
                  <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy} data-edit-button>
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={onAccept}
                  disabled={busy || Boolean(stale) || !online || editing}
                  title={!online ? "Reconnect to apply changes" : undefined}
                >
                  Accept
                </Button>
              </>
            ) : null}
          </div>
        )
      ) : null}
      {draft && !canEdit && !isApplied ? (
        <p className="mt-2 text-xs text-muted">View-only: you can read and preview this, but not accept it.</p>
      ) : null}
      {draft && canEdit && !online && !isApplied ? (
        <p className="mt-2 text-xs text-muted">You’re offline. Reconnect to accept this proposal.</p>
      ) : null}
    </li>
  );
}

function EvidenceRow({ item, missing, onView }: { item: EvidenceRef; missing: boolean; onView: () => void }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-control bg-warm px-2.5 py-1.5">
      <span className="min-w-0 text-sm">
        <span className="break-words">“{item.excerpt}”</span>
        <span className="ml-1.5 text-xs text-muted">v{item.version}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={onView} disabled={missing} aria-label={`View ${item.excerpt}`}>
        View
      </Button>
    </li>
  );
}
