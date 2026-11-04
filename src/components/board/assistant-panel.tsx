"use client";

import { Check, ChevronDown, Eye, EyeOff, Pencil, Sparkles, ThumbsDown, ThumbsUp, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { CONFIDENCE_BANDS, confidenceBand } from "@/lib/assistant/bands";
import {
  ASSISTANT_ACTION_LABELS,
  ASSISTANT_ACTIONS,
  ASSISTANT_FOCUSES,
  DEFAULT_VISIBLE_FINDINGS,
  FOCUS_LABELS,
  FEEDBACK_REASONS,
  FEEDBACK_REASON_LABELS,
  MAX_GUIDANCE,
  MAX_PROPOSAL_TEXT,
  RULE_LABELS,
  type AssistantAction,
  type AssistantFeedback,
  type AssistantFocus,
  type AssistantTemplateContext,
  type PlanningClarity,
  type FeedbackReason,
  type FeedbackRequest,
  type RuleId,
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

/** Most useful first (v1.1 ranking); Explain rows and older records without a score keep their order. */
export function byUsefulness(records: AssistantProposalRecord[]): AssistantProposalRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => (b.record.usefulness ?? -1) - (a.record.usefulness ?? -1) || a.index - b.index)
    .map(({ record }) => record);
}

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
  const [meta, setMeta] = useState<{
    exclusions: string[];
    guidanceIgnored: boolean;
    truncated: boolean;
    suppressed: number;
    template: AssistantTemplateContext | null;
    focus: AssistantFocus;
    clarity: PlanningClarity | null;
  } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hiddenRules, setHiddenRules] = useState<string[] | null>(null);
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
        setItems(byUsefulness(records.filter((record) => record.status === "pending" || record.status === "stale")));
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
    async (nextAction: AssistantAction, nextContext: "board" | "object", nextFocus: AssistantFocus = "everything") => {
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
          ...(nextFocus !== "everything" ? { focus: nextFocus } : {}),
        });
        setItems(byUsefulness(result.proposals));
        setShowAll(false);
        setHiddenRules(null);
        setMeta({
          exclusions: result.exclusions,
          guidanceIgnored: result.guidanceIgnored,
          truncated: result.truncated,
          suppressed: result.suppressed ?? 0,
          focus: result.focus ?? nextFocus,
          clarity: result.clarity ?? null,
          template: result.template ?? null,
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

  /** Optimistic: the card shows the choice at once and goes back if saving fails. */
  async function giveFeedback(record: AssistantProposalRecord, request: FeedbackRequest | null) {
    const previous = record.feedback ?? null;
    const optimistic: AssistantFeedback | null = request
      ? { helpful: request.helpful, reasons: request.helpful ? [] : (request.reasons ?? []) }
      : null;
    const put = (feedback: AssistantFeedback | null) =>
      setItems((current) => current.map((item) => (item.id === record.id ? { ...item, feedback } : item)));
    put(optimistic);
    try {
      if (request) {
        put(await services.setFeedback(record.id, request));
        if (request.hideRule && record.rule_id) {
          setHiddenRules((current) => [...new Set([...(current ?? []), record.rule_id as string])]);
          onAnnounce(`${RULE_LABELS[record.rule_id]} are hidden on this board for you.`);
        } else {
          onAnnounce("Thanks. Feedback saved.");
        }
      } else {
        await services.clearFeedback(record.id);
        onAnnounce("Feedback removed.");
      }
    } catch (caught) {
      put(previous);
      setError(errorMessage(caught));
    }
  }

  async function showRule(ruleId: string) {
    try {
      await services.setRuleHidden(ruleId, false);
      setHiddenRules((current) => (current ?? []).filter((id) => id !== ruleId));
      onAnnounce(`${RULE_LABELS[ruleId as RuleId] ?? "Findings"} will be shown again next time you run the Assistant.`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function loadHiddenRules() {
    try {
      setHiddenRules(await services.hiddenRules());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

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
        {meta?.template ? (
          <p className="mt-4 text-xs leading-relaxed text-muted" data-testid="assistant-template">
            Tuned for this board’s template: aiming for {meta.template.outcome}.
          </p>
        ) : null}
        {meta?.truncated ? <p className="mt-2 text-xs text-muted">Showing the 10 most useful findings.</p> : null}
        {meta && meta.suppressed > 0 ? (
          <div className="mt-2 text-xs text-muted">
            {meta.suppressed} {meta.suppressed === 1 ? "finding was" : "findings were"} left out because of your
            feedback.{" "}
            {hiddenRules === null ? (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-ink"
                onClick={() => void loadHiddenRules()}
              >
                Manage hidden findings
              </button>
            ) : null}
          </div>
        ) : null}
        {hiddenRules && hiddenRules.length > 0 ? (
          <ul aria-label="Hidden types of finding" className="mt-2 flex flex-col gap-1.5">
            {hiddenRules.map((ruleId) => (
              <li
                key={ruleId}
                className="flex items-center justify-between gap-2 rounded-control bg-sunken px-3 py-1.5 text-xs"
              >
                <span>{RULE_LABELS[ruleId as RuleId] ?? ruleId}: hidden on this board</span>
                <Button size="sm" variant="ghost" onClick={() => void showRule(ruleId)}>
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {meta?.clarity && phase === "idle" ? <ClarityCard clarity={meta.clarity} /> : null}

        {hasRun && !explainOnly && phase !== "loading" ? (
          <div role="group" aria-labelledby="assistant-focus" className="mt-4">
            <p id="assistant-focus" className="text-sm font-medium">
              What should Assistant focus on?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ASSISTANT_FOCUSES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={(meta?.focus ?? "everything") === option}
                  disabled={phase !== "idle"}
                  onClick={() => void run(action, contextKind, option)}
                  className={cn(
                    "min-h-9 rounded-full border px-3.5 text-[13px] transition-colors disabled:opacity-50 pointer-coarse:min-h-11",
                    (meta?.focus ?? "everything") === option
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  {FOCUS_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
                {(showAll || explainOnly ? items : items.slice(0, DEFAULT_VISIBLE_FINDINGS)).map((record) => (
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
                    onFeedback={(request) => void giveFeedback(record, request)}
                    onUndo={(objectId) => {
                      if (onUndoApplied(objectId)) {
                        setUndone((current) => new Set(current).add(record.id));
                        onAnnounce("Proposal undone. The note was removed from the board.");
                      }
                    }}
                  />
                ))}
              </ul>
              {!showAll && !explainOnly && items.length > DEFAULT_VISIBLE_FINDINGS ? (
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setShowAll(true)}>
                  <ChevronDown className="size-4" aria-hidden />
                  Show more findings ({items.length - DEFAULT_VISIBLE_FINDINGS})
                </Button>
              ) : null}
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
  onFeedback: (request: FeedbackRequest | null) => void;
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
  onFeedback,
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
  const band = CONFIDENCE_BANDS[confidenceBand(record.confidence)];
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
        <span className="text-xs font-medium text-ink" title={band.explanation}>
          {band.label}
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
      <p className="mt-1 text-xs leading-snug text-muted">
        {band.label}: {band.explanation}
      </p>

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
      {record.rule_id ? <FeedbackControls record={record} onFeedback={onFeedback} /> : null}
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

/**
 * Helpful / Not helpful, with optional reasons and "hide this type". Changes ranking for the
 * next run only; it never changes the board. Feedback can be changed or removed at any time.
 */
function FeedbackControls({
  record,
  onFeedback,
}: {
  record: AssistantProposalRecord;
  onFeedback: (request: FeedbackRequest | null) => void;
}) {
  const feedback = record.feedback ?? null;
  const reasons = new Set<FeedbackReason>(feedback?.reasons ?? []);
  const groupId = `feedback-${record.id}`;
  const toggleReason = (reason: FeedbackReason) => {
    const next = new Set(reasons);
    if (next.has(reason)) next.delete(reason);
    else next.add(reason);
    onFeedback({ helpful: false, reasons: [...next] });
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div role="group" aria-labelledby={groupId} className="flex flex-wrap items-center gap-2">
        <span id={groupId} className="text-xs text-muted">
          Was this useful?
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={feedback?.helpful === true}
          className={cn(feedback?.helpful === true && "bg-success-soft text-success")}
          onClick={() => onFeedback(feedback?.helpful === true ? null : { helpful: true })}
        >
          <ThumbsUp className="size-4" aria-hidden />
          Helpful
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={feedback?.helpful === false}
          className={cn(feedback?.helpful === false && "bg-danger-soft text-danger")}
          onClick={() => onFeedback(feedback?.helpful === false ? null : { helpful: false, reasons: [] })}
        >
          <ThumbsDown className="size-4" aria-hidden />
          Not helpful
        </Button>
      </div>
      {feedback?.helpful === false ? (
        <div className="mt-2 flex flex-col gap-2">
          <div role="group" aria-label="Why wasn’t it helpful? (optional)" className="flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={reasons.has(reason)}
                onClick={() => toggleReason(reason)}
                className={cn(
                  "min-h-8 rounded-full border px-3 text-xs transition-colors pointer-coarse:min-h-11",
                  reasons.has(reason)
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-line bg-surface hover:border-line-strong",
                )}
              >
                {FEEDBACK_REASON_LABELS[reason]}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => onFeedback({ helpful: false, reasons: [...reasons], hideRule: true })}
          >
            Hide this type of finding on this board
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Planning clarity, 0–100, with what is good, what is missing and what would help most. */
function ClarityCard({ clarity }: { clarity: PlanningClarity }) {
  const tone = clarity.score >= 75 ? "bg-success" : clarity.score >= 50 ? "bg-warning" : "bg-danger";
  return (
    <section aria-labelledby="clarity-heading" className="mt-4 rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="clarity-heading" className="text-sm font-medium">
          Planning clarity
        </h3>
        <p className="text-sm">
          <span className="font-display text-2xl tabular-nums">{clarity.score}</span>
          <span className="text-muted">/100</span>
        </p>
      </div>
      <div
        role="meter"
        aria-labelledby="clarity-heading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clarity.score}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${clarity.score}%` }} />
      </div>
      {clarity.strengths.length > 0 ? (
        <>
          <h4 className="mt-3 text-xs font-medium text-muted">Strengths</h4>
          <ul className="mt-1 list-disc pl-4 text-sm leading-relaxed">
            {clarity.strengths.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}
      {clarity.gaps.length > 0 ? (
        <>
          <h4 className="mt-3 text-xs font-medium text-muted">Gaps</h4>
          <ul className="mt-1 list-disc pl-4 text-sm leading-relaxed">
            {clarity.gaps.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}
      {clarity.improvements.length > 0 ? (
        <>
          <h4 className="mt-3 text-xs font-medium text-muted">What would improve it</h4>
          <ul className="mt-1 list-disc pl-4 text-sm leading-relaxed">
            {clarity.improvements.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
