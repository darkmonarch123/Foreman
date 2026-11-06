"use client";

import {
  Download,
  Keyboard,
  LayoutDashboard,
  Maximize,
  MessageSquare,
  Redo2,
  Share2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SyncStatus } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { ContextMenu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { ASSISTANT_ACTION_LABELS, type AssistantAction, type ProposalDraft } from "@/lib/assistant/types";
import { BOARD_SETTINGS_ACTIVITY, MEMBERSHIP_ACTIVITY, colorForUser } from "@/lib/board/activity-text";
import { TYPE_LABELS, describeObject, supportsText } from "@/lib/board/defaults";
import { BoardEngine, type EngineNotice } from "@/lib/board/engine";
import { contentBounds, fitCamera, screenToWorld, zoomAt, type Camera, type Point } from "@/lib/board/geometry";
import {
  ACTIVITY_PAGE_SIZE,
  COMMENTS_PAGE_SIZE,
  type ActivityItem,
  type BoardComment,
  type BoardServices,
  type Member,
} from "@/lib/board/services";
import { createLocalPendingStore, type PendingStore } from "@/lib/board/storage";
import { alignObjects, restack, type AlignMode } from "@/lib/board/arrange";
import { TOOLS, isTypingTarget, toolForKey, type Tool } from "@/lib/board/tools";
import type { BoardState, BoardSummary, CanvasObject, CanvasProps } from "@/lib/board/types";
import { ERROR_CATALOG, errorMessage, toAppError } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { startTimer } from "@/lib/perf/client";
import { AssistantPanel, type AssistantIntent } from "./assistant-panel";
import { BoardTopBar } from "./board-top-bar";
import { CanvasStage, type RemoteCursor } from "./canvas-stage";
import { CommandPalette, type Command } from "./command-palette";
import { ExportDialog } from "./export-dialog";
import { AddSheet, DesktopToolbar, EditSheet, MoreSheet, PhoneToolbar, type PhoneSheet } from "./board-toolbar";
import { ObjectToolbar } from "./object-toolbar";
import { ShareDialog } from "./share-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { ActivityPanel, CommentsPanel, OutlinePanel, PeoplePanel, SidePanel, type PanelTab } from "./side-panel";
import { ToolRail } from "./tool-rail";
import { ZoomControls } from "./zoom-controls";

/**
 * Where the side panel and Assistant sit: a bottom sheet on phones (above the bottom toolbar,
 * clear of the home indicator), an overlay on the right on tablets, and a column beside the
 * board from `lg` up.
 */
const SHEET_CONTAINER =
  "fixed inset-x-0 bottom-0 z-40 max-h-[88dvh] overflow-hidden rounded-t-sheet shadow-sheet animate-sheet-in tablet:absolute tablet:inset-x-auto tablet:inset-y-0 tablet:right-0 tablet:z-20 tablet:max-h-none tablet:animate-none tablet:rounded-none tablet:shadow-lift lg:static lg:shadow-none";

export interface WorkspaceUser {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string;
  email?: string;
  theme_preference?: "system" | "light" | "dark";
}

interface BoardWorkspaceProps {
  initial: BoardState;
  initialMembers: Member[];
  currentUser: WorkspaceUser;
  services: BoardServices;
  /** Overridable for tests; defaults to localStorage scoped to this user and board. */
  pendingStore?: PendingStore;
  /** Open the Assistant panel on arrival, when the Assistant is available. */
  initialAssistantOpen?: boolean;
}

interface Paged<T> {
  items: T[] | null;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
}

const EMPTY_PAGE = { items: null, error: null, hasMore: false, loadingMore: false };
const CURSOR_TTL_MS = 8_000;

export function BoardWorkspace({
  initial,
  initialMembers,
  currentUser,
  services,
  pendingStore,
  initialAssistantOpen = false,
}: BoardWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();
  const boardId = initial.board.id;

  // -- board + membership -------------------------------------------------------
  const [board, setBoard] = useState<BoardSummary>(initial.board);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [accessLost, setAccessLost] = useState(false);
  const role = board.role;
  const canEdit = role !== "VIEWER";
  const canComment = canEdit || board.viewers_can_comment;

  // -- sync engine ------------------------------------------------------------------
  const noticeHandler = useRef<(notice: EngineNotice) => void>(() => {});
  const [engine] = useState(
    () =>
      new BoardEngine({
        userId: currentUser.id,
        initial,
        transport: services.transport,
        store: pendingStore ?? createLocalPendingStore(currentUser.id, boardId),
        canEdit: initial.board.role !== "VIEWER",
        onNotice: (notice) => noticeHandler.current(notice),
      }),
  );
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  useEffect(() => {
    noticeHandler.current = (notice) => {
      if (notice.kind === "sync-failed") return; // shown as a persistent banner instead
      toast.error(notice.message);
    };
  }, [toast]);

  useEffect(() => {
    engine.start();
    return () => engine.dispose();
  }, [engine]);

  // Board open: from the start of the page load to the first painted board.
  const firstInteraction = useRef(false);
  useEffect(() => {
    startTimer("board_open", { boardId, startedAt: 0 }).endAfterPaint();
  }, [boardId]);

  useEffect(() => {
    engine.setCanEdit(canEdit);
  }, [engine, canEdit]);

  // -- view state ---------------------------------------------------------------------
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setPrimaryId] = useState<string | null>(null);
  // Multi-select: further items selected with Shift+click (or Select all) besides the primary one.
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const setSelectedId = useCallback((id: string | null) => {
    setPrimaryId(id);
    setExtraIds([]);
  }, []);
  // Phone only (below 744px): which bottom sheet is open. Tablet and desktop ignore it.
  const [phoneSheet, setPhoneSheet] = useState<PhoneSheet>(null);
  const [phonePanel, setPhonePanel] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: -120, y: -200, zoom: 1 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const fitted = useRef(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("people");
  const [dialog, setDialog] = useState<"share" | "export" | "shortcuts" | "palette" | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string | null; at: Point } | null>(null);
  const [commentTargetId, setCommentTargetId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const assistant = services.assistant ?? null;
  const [assistantOpen, setAssistantOpen] = useState(() => initialAssistantOpen && Boolean(assistant));

  // `?assistant=open` has done its job once the panel is open; drop it so a reload doesn't reopen it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("assistant") !== "open") return;
    url.searchParams.delete("assistant");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  const [assistantIntent, setAssistantIntent] = useState<AssistantIntent | null>(null);
  const [ghostDraft, setGhostDraft] = useState<ProposalDraft | null>(null);
  const [online, setOnline] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const selected = selectedId ? (snapshot.byId.get(selectedId) ?? null) : null;
  const selectedVisible = selected && !selected.deleted ? selected : null;
  const selection: CanvasObject[] = useMemo(() => {
    if (!selectedVisible) return [];
    const extras = extraIds
      .map((id) => snapshot.byId.get(id))
      .filter((object): object is CanvasObject =>
        Boolean(object && !object.deleted && object.id !== selectedVisible.id),
      );
    return [selectedVisible, ...extras];
  }, [selectedVisible, extraIds, snapshot.byId]);
  const commentTarget = commentTargetId ? (snapshot.byId.get(commentTargetId) ?? null) : null;

  // Fit the board once the canvas has a size.
  useEffect(() => {
    if (fitted.current || viewport.width === 0) return;
    fitted.current = true;
    const bounds = contentBounds(engine.getSnapshot().objects, 80);
    if (bounds) setCamera(fitCamera(bounds, viewport, 1));
    else setCamera({ x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 });
  }, [engine, viewport]);

  // On small screens the panel starts closed so the canvas is visible.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setPanelOpen(false);
  }, []);

  // -- presence, cursors, comments, activity ------------------------------------------
  const [onlineIds, setOnlineIds] = useState<ReadonlySet<string>>(() => new Set([currentUser.id]));
  const [cursorMap, setCursorMap] = useState<ReadonlyMap<string, { x: number; y: number; at: number }>>(
    () => new Map(),
  );
  const [comments, setComments] = useState<Paged<BoardComment>>(EMPTY_PAGE);
  const [activity, setActivity] = useState<Paged<ActivityItem>>(EMPTY_PAGE);
  const activityWanted = useRef(false);
  const membersRef = useRef(members);
  const onlineRef = useRef(onlineIds);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const loadComments = useCallback(async () => {
    try {
      const items = await services.loadComments();
      setComments({ items, error: null, hasMore: items.length === COMMENTS_PAGE_SIZE, loadingMore: false });
    } catch (error) {
      setComments((current) => ({ ...current, error: errorMessage(error), loadingMore: false }));
    }
  }, [services]);

  const loadActivity = useCallback(async () => {
    try {
      const items = await services.loadActivity();
      setActivity({ items, error: null, hasMore: items.length === ACTIVITY_PAGE_SIZE, loadingMore: false });
    } catch (error) {
      setActivity((current) => ({ ...current, error: errorMessage(error), loadingMore: false }));
    }
  }, [services]);

  const refreshBoard = useCallback(async () => {
    try {
      const [nextBoard, nextMembers] = await Promise.all([services.getBoard(), services.loadMembers()]);
      setBoard(nextBoard);
      setMembers(nextMembers);
    } catch (error) {
      const code = toAppError(error).code;
      if (code === "BOARD_NOT_FOUND" || code === "BOARD_ACCESS_DENIED") setAccessLost(true);
    }
  }, [services]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    let activityTimer: ReturnType<typeof setTimeout> | null = null;

    const disconnect = services.realtime.connect({
      onOperation: (operation) => engine.receive(operation),
      onComment: (event) => {
        setComments((current) => {
          if (!current.items) return current;
          if (event.action === "deleted") {
            return { ...current, items: current.items.filter((comment) => comment.id !== event.comment.id) };
          }
          const exists = current.items.some((comment) => comment.id === event.comment.id);
          return {
            ...current,
            items: exists
              ? current.items.map((comment) => (comment.id === event.comment.id ? event.comment : comment))
              : [event.comment, ...current.items],
          };
        });
        if (event.action === "created" && event.comment.author_id !== currentUser.id && event.comment.author) {
          setAnnouncement(`New comment from ${event.comment.author.first_name} ${event.comment.author.last_name}`);
        }
      },
      onActivity: (event) => {
        if (MEMBERSHIP_ACTIVITY.has(event.type) || BOARD_SETTINGS_ACTIVITY.has(event.type)) void refreshBoard();
        if (!activityWanted.current) return;
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => void loadActivity(), 400);
      },
      onPresence: (ids) => {
        // Presence payloads come from other clients. Only people the server
        // says are members of this board are ever shown.
        const memberIds = new Set(membersRef.current.map((member) => member.user_id));
        const next = new Set(ids.filter((id) => memberIds.has(id)));
        next.add(currentUser.id);
        const previous = onlineRef.current;
        const nameOf = (id: string) => {
          const member = membersRef.current.find((entry) => entry.user_id === id);
          return member ? `${member.first_name} ${member.last_name}` : null;
        };
        for (const id of next) {
          if (!previous.has(id) && id !== currentUser.id) {
            const name = nameOf(id);
            if (name) setAnnouncement(`${name} joined the board`);
          }
        }
        for (const id of previous) {
          if (!next.has(id) && id !== currentUser.id) {
            const name = nameOf(id);
            if (name) setAnnouncement(`${name} left the board`);
          }
        }
        onlineRef.current = next;
        setOnlineIds(next);
        setCursorMap((current) => {
          const pruned = new Map([...current].filter(([id]) => next.has(id)));
          return pruned.size === current.size ? current : pruned;
        });
      },
      onCursor: (cursor) => {
        setCursorMap((current) => new Map(current).set(cursor.userId, { x: cursor.x, y: cursor.y, at: Date.now() }));
      },
      onStatus: (connected) => {
        setRealtimeConnected(connected);
        engine.setRealtimeConnected(connected);
      },
    });

    // A cursor that stops reporting is removed rather than left frozen on screen.
    const sweep = setInterval(() => {
      setCursorMap((current) => {
        const now = Date.now();
        const live = new Map([...current].filter(([, value]) => now - value.at < CURSOR_TTL_MS));
        return live.size === current.size ? current : live;
      });
    }, 2_000);

    return () => {
      disconnect();
      clearInterval(sweep);
      if (activityTimer) clearTimeout(activityTimer);
    };
  }, [services, engine, currentUser.id, loadActivity, refreshBoard]);

  // Someone who joins while we are connected is not in the member list yet.
  useEffect(() => {
    const known = new Set(members.map((member) => member.user_id));
    if ([...onlineIds].some((id) => !known.has(id))) void refreshBoard();
  }, [onlineIds, members, refreshBoard]);

  useEffect(() => {
    if (panelOpen && panelTab === "activity") {
      activityWanted.current = true;
      void loadActivity();
    }
  }, [panelOpen, panelTab, loadActivity]);

  // -- browser connectivity and unsaved work -----------------------------------------------
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      engine.setOnline(navigator.onLine);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [engine]);

  useEffect(() => {
    if (snapshot.pendingCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [snapshot.pendingCount]);

  // -- actions ---------------------------------------------------------------------------
  const zoomTo = useCallback(
    (factor: number) => {
      setCamera((current) => zoomAt(current, { x: viewport.width / 2, y: viewport.height / 2 }, current.zoom * factor));
    },
    [viewport],
  );

  const zoomToFit = useCallback(() => {
    const bounds = contentBounds(engine.getSnapshot().objects, 80);
    if (bounds && viewport.width > 0) setCamera(fitCamera(bounds, viewport, 1));
  }, [engine, viewport]);

  const focusObject = useCallback(
    (id: string) => {
      const object = engine.getSnapshot().byId.get(id);
      if (!object || object.deleted) return;
      setSelectedId(id);
      setCamera((current) => ({
        zoom: current.zoom,
        x: object.x + object.width / 2 - viewport.width / current.zoom / 2,
        y: object.y + object.height / 2 - viewport.height / current.zoom / 2,
      }));
    },
    [engine, viewport, setSelectedId],
  );

  const duplicate = useCallback(
    (id: string) => {
      const object = engine.getSnapshot().byId.get(id);
      if (!object) return;
      const copy = engine.create({
        type: object.type,
        x: object.x + 24,
        y: object.y + 24,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        props: { ...object.props },
      });
      if (copy) setSelectedId(copy);
    },
    [engine, setSelectedId],
  );

  const removeObject = useCallback(
    (id: string) => {
      engine.remove(id);
      setPrimaryId((current) => (current === id ? null : current));
      setExtraIds((current) => current.filter((extra) => extra !== id));
      setEditingId((current) => (current === id ? null : current));
    },
    [engine],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const top = Math.max(
        0,
        ...engine
          .getSnapshot()
          .objects.map((object) => object.z_index)
          .filter((z) => Number.isSafeInteger(z)),
      );
      engine.update(id, { z_index: top + 1 });
    },
    [engine],
  );

  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const object = engine.getSnapshot().byId.get(id);
      if (object) engine.move(id, { x: object.x + dx, y: object.y + dy });
    },
    [engine],
  );

  const toggleSelect = useCallback(
    (id: string) => {
      if (!selectedId) {
        setSelectedId(id);
        return;
      }
      if (id === selectedId) {
        // Removing the primary item promotes the next one.
        setPrimaryId(extraIds[0] ?? null);
        setExtraIds(extraIds.slice(1));
        return;
      }
      setExtraIds((current) => (current.includes(id) ? current.filter((extra) => extra !== id) : [...current, id]));
    },
    [selectedId, extraIds, setSelectedId],
  );

  const selectAll = useCallback(() => {
    const live = engine.getSnapshot().objects.filter((object) => !object.deleted);
    setPrimaryId(live[0]?.id ?? null);
    setExtraIds(live.slice(1).map((object) => object.id));
  }, [engine]);

  const styleSelection = useCallback(
    (props: CanvasProps) => {
      for (const object of selection) engine.update(object.id, { props });
    },
    [engine, selection],
  );

  const alignSelection = useCallback(
    (mode: AlignMode) => {
      for (const move of alignObjects(selection, mode)) engine.move(move.id, { x: move.x, y: move.y });
      setAnnouncement(`${selection.length} items aligned`);
    },
    [engine, selection],
  );

  const restackSelected = useCallback(
    (direction: "forward" | "backward") => {
      if (!selectedVisible) return;
      const live = engine.getSnapshot().objects.filter((object) => !object.deleted);
      for (const change of restack(live, selectedVisible.id, direction)) {
        engine.update(change.id, { z_index: change.z_index });
      }
    },
    [engine, selectedVisible],
  );

  const duplicateSelection = useCallback(() => {
    for (const object of selection) duplicate(object.id);
  }, [selection, duplicate]);

  const deleteSelection = useCallback(() => {
    for (const object of selection) removeObject(object.id);
    setSelectedId(null);
  }, [selection, removeObject, setSelectedId]);

  const openComments = useCallback((targetId: string | null) => {
    setCommentTargetId(targetId);
    setPanelTab("comments");
    setPanelOpen(true);
    setPhonePanel(true);
    setPhoneSheet(null);
    requestAnimationFrame(() => document.getElementById("new-comment")?.focus());
  }, []);

  const openAssistant = useCallback(
    (request?: { action: AssistantAction; context: "board" | "object" }) => {
      if (!assistant) return;
      setAssistantOpen(true);
      setPhoneSheet(null);
      if (request) setAssistantIntent({ nonce: Date.now() + Math.random(), ...request });
    },
    [assistant],
  );

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    setGhostDraft(null);
  }, []);

  const previewAssistant = useCallback(
    (draft: ProposalDraft | null) => {
      setGhostDraft(draft);
      if (!draft) return;
      // Bring the preview into view; the camera is left alone when it is already visible.
      setCamera((current) => {
        const { x, y, width, height } = draft.object;
        const visibleW = viewport.width / current.zoom;
        const visibleH = viewport.height / current.zoom;
        const inView =
          x >= current.x && y >= current.y && x + width <= current.x + visibleW && y + height <= current.y + visibleH;
        if (inView || viewport.width === 0) return current;
        return { zoom: current.zoom, x: x + width / 2 - visibleW / 2, y: y + height / 2 - visibleH / 2 };
      });
    },
    [viewport],
  );

  const changeTool = useCallback(
    (next: Tool) => {
      const definition = TOOLS.find((entry) => entry.id === next);
      if (definition?.requiresEdit && !canEdit) return;
      setTool(next);
    },
    [canEdit],
  );

  // -- keyboard shortcuts --------------------------------------------------------------------
  const overlayOpen = dialog !== null || contextMenu !== null;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;

      if (mod && key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog((current) => (current === "palette" ? null : current === null ? "palette" : current));
        return;
      }
      if (overlayOpen || isTypingTarget(event.target)) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const onControl = Boolean(
        target?.closest("button, a, [role='tab'], [role='menuitem'], [role='option'], summary"),
      );
      const inArrowWidget = Boolean(target?.closest("[role='tablist'], [role='menu'], [role='listbox']"));

      if (mod) {
        const lower = key.toLowerCase();
        if (lower === "z") {
          event.preventDefault();
          if (event.shiftKey) engine.redo();
          else engine.undo();
        } else if (lower === "y") {
          event.preventDefault();
          engine.redo();
        } else if (lower === "a" && !onControl) {
          event.preventDefault();
          selectAll();
        } else if (lower === "d" && selectedId) {
          event.preventDefault();
          duplicate(selectedId);
        } else if (key === "0") {
          event.preventDefault();
          zoomToFit();
        } else if (key === "=" || key === "+") {
          event.preventDefault();
          zoomTo(1.2);
        } else if (key === "-") {
          event.preventDefault();
          zoomTo(1 / 1.2);
        }
        return;
      }
      if (event.altKey) return;

      if (key === "?") {
        event.preventDefault();
        setDialog("shortcuts");
      } else if (key === "Escape") {
        if (tool !== "select") setTool("select");
        else setSelectedId(null);
      } else if ((key === "Delete" || key === "Backspace") && selectedId && canEdit) {
        event.preventDefault();
        deleteSelection();
      } else if (key === "Enter" && selectedVisible && canEdit && !onControl && supportsText(selectedVisible.type)) {
        event.preventDefault();
        setEditingId(selectedVisible.id);
      } else if (key.startsWith("Arrow") && selectedId && canEdit && !inArrowWidget) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        nudge(
          selectedId,
          key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0,
          key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0,
        );
      } else if (key.toLowerCase() === "f" && assistant) {
        // Never while typing (handled above); toggles the Assistant panel.
        event.preventDefault();
        if (assistantOpen) closeAssistant();
        else openAssistant();
      } else if (key.length === 1) {
        const next = toolForKey(key);
        if (next) changeTool(next);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    overlayOpen,
    engine,
    selectedId,
    selectedVisible,
    canEdit,
    tool,
    duplicate,
    deleteSelection,
    selectAll,
    setSelectedId,
    nudge,
    zoomTo,
    zoomToFit,
    changeTool,
    assistant,
    assistantOpen,
    openAssistant,
    closeAssistant,
  ]);

  // -- derived data -------------------------------------------------------------------------------
  const cursors: RemoteCursor[] = useMemo(() => {
    const list: RemoteCursor[] = [];
    for (const [userId, position] of cursorMap) {
      if (userId === currentUser.id || !onlineIds.has(userId)) continue;
      const member = members.find((entry) => entry.user_id === userId);
      if (!member) continue; // never draw a cursor for someone who is not a member
      list.push({ userId, name: member.first_name, color: colorForUser(userId), x: position.x, y: position.y });
    }
    return list;
  }, [cursorMap, onlineIds, members, currentUser.id]);

  const onlineMembers = useMemo(() => members.filter((member) => onlineIds.has(member.user_id)), [members, onlineIds]);

  const status: SyncStatus = accessLost
    ? "failed"
    : !canEdit && snapshot.status === "saved"
      ? "view-only"
      : snapshot.status;

  const viewportBounds = useMemo(() => {
    const origin = screenToWorld(camera, { x: 0, y: 0 });
    return { x: origin.x, y: origin.y, width: viewport.width / camera.zoom, height: viewport.height / camera.zoom };
  }, [camera, viewport]);

  const contextItems: MenuItem[] = useMemo(() => {
    const id = contextMenu?.id ?? null;
    const target = id ? snapshot.byId.get(id) : null;
    const assistantItems = (scope: "board" | "object"): MenuItem[] =>
      !assistant
        ? []
        : (["explain_board", "find_planning_gaps", "propose_plan"] as const)
            .filter((action) => canEdit || action !== "propose_plan")
            .map((action, index) => ({
              id: `assistant-${action}`,
              label: ASSISTANT_ACTION_LABELS[action].label,
              icon: index === 0 ? <Sparkles /> : undefined,
              separated: index === 0,
              onSelect: () => {
                if (scope === "object" && target) setSelectedId(target.id);
                openAssistant({ action, context: scope });
              },
            }));
    if (!target) {
      return [
        { id: "fit", label: "Zoom to fit", icon: <Maximize />, onSelect: zoomToFit },
        ...(canComment
          ? [
              {
                id: "comment",
                label: "Comment on the board",
                icon: <MessageSquare />,
                onSelect: () => openComments(null),
              },
            ]
          : []),
        { id: "export", label: "Export as PNG", icon: <Download />, onSelect: () => setDialog("export") },
        ...assistantItems("board"),
      ];
    }
    return [
      ...(canEdit && supportsText(target.type)
        ? [{ id: "edit", label: "Edit text", shortcut: "Enter", onSelect: () => setEditingId(target.id) }]
        : []),
      ...(canEdit
        ? [
            { id: "duplicate", label: "Duplicate", onSelect: () => duplicate(target.id) },
            { id: "front", label: "Bring to front", onSelect: () => bringToFront(target.id) },
            {
              id: "forward",
              label: "Bring forward",
              onSelect: () => {
                const live = engine.getSnapshot().objects.filter((object) => !object.deleted);
                for (const change of restack(live, target.id, "forward"))
                  engine.update(change.id, { z_index: change.z_index });
              },
            },
            {
              id: "backward",
              label: "Send backward",
              onSelect: () => {
                const live = engine.getSnapshot().objects.filter((object) => !object.deleted);
                for (const change of restack(live, target.id, "backward"))
                  engine.update(change.id, { z_index: change.z_index });
              },
            },
          ]
        : []),
      ...(canComment
        ? [{ id: "comment", label: "Comment on this item", onSelect: () => openComments(target.id) }]
        : []),
      ...assistantItems("object"),
      ...(canEdit
        ? [
            {
              id: "delete",
              label: "Delete",
              danger: true,
              separated: true,
              shortcut: "Del",
              onSelect: () => removeObject(target.id),
            },
          ]
        : []),
    ];
  }, [
    engine,
    setSelectedId,
    contextMenu,
    snapshot.byId,
    canEdit,
    canComment,
    assistant,
    zoomToFit,
    openComments,
    duplicate,
    bringToFront,
    removeObject,
    openAssistant,
  ]);

  const commands: Command[] = useMemo(
    () => [
      ...TOOLS.map((definition) => ({
        id: `tool-${definition.id}`,
        label: `Tool: ${definition.label}`,
        hint: definition.shortcut,
        run: () => changeTool(definition.id),
        disabled: definition.requiresEdit && !canEdit,
      })),
      { id: "undo", label: "Undo", icon: <Undo2 />, run: () => void engine.undo(), disabled: !snapshot.canUndo },
      { id: "redo", label: "Redo", icon: <Redo2 />, run: () => void engine.redo(), disabled: !snapshot.canRedo },
      { id: "fit", label: "Zoom to fit", icon: <Maximize />, run: zoomToFit },
      ...(assistant
        ? [
            {
              id: "assistant",
              label: "Open Foreman Assistant",
              icon: <Sparkles />,
              hint: "F",
              run: () => openAssistant(),
            },
          ]
        : []),
      { id: "export", label: "Export as PNG", icon: <Download />, run: () => setDialog("export") },
      {
        id: "share",
        label: "Share board",
        icon: <Share2 />,
        run: () => setDialog("share"),
        disabled: role !== "OWNER",
      },
      {
        id: "people",
        label: "Show people",
        icon: <Users />,
        run: () => {
          setPanelTab("people");
          setPanelOpen(true);
        },
      },
      {
        id: "comments",
        label: "Show comments",
        icon: <MessageSquare />,
        run: () => {
          setPanelTab("comments");
          setPanelOpen(true);
        },
      },
      {
        id: "activity",
        label: "Show activity",
        run: () => {
          setPanelTab("activity");
          setPanelOpen(true);
        },
      },
      {
        id: "outline",
        label: "Show board outline",
        run: () => {
          setPanelTab("outline");
          setPanelOpen(true);
        },
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        icon: <Keyboard />,
        hint: "?",
        run: () => setDialog("shortcuts"),
      },
      { id: "dashboard", label: "Go to dashboard", icon: <LayoutDashboard />, run: () => router.push("/dashboard") },
    ],
    [
      canEdit,
      role,
      engine,
      snapshot.canUndo,
      snapshot.canRedo,
      zoomToFit,
      changeTool,
      router,
      assistant,
      openAssistant,
    ],
  );

  const selectionActions = {
    selection,
    canEdit,
    onStyle: styleSelection,
    onForward: () => restackSelected("forward"),
    onBackward: () => restackSelected("backward"),
    onDuplicate: duplicateSelection,
    onDelete: deleteSelection,
    onAlign: alignSelection,
  };
  const moreActions = {
    isOwner: role === "OWNER",
    boardId,
    onExport: () => setDialog("export"),
    onShare: () => setDialog("share"),
    onShortcuts: () => setDialog("shortcuts"),
    onFit: zoomToFit,
  };

  // -- access lost ----------------------------------------------------------------------------------
  if (accessLost) {
    return (
      <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-coral-tint text-error" aria-hidden>
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="font-display text-headline">You no longer have access to this board</h1>
        <p className="max-w-md text-[15px] leading-relaxed text-muted">
          The board was deleted, or its owner removed you from it.
          {snapshot.pendingCount > 0
            ? ` ${snapshot.pendingCount} of your recent ${snapshot.pendingCount === 1 ? "change was" : "changes were"} not saved.`
            : ""}
        </p>
        <LinkButton href="/dashboard">Go to dashboard</LinkButton>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <BoardTopBar
        boardId={boardId}
        title={board.title}
        role={role}
        status={status}
        pendingCount={snapshot.pendingCount}
        canUndo={snapshot.canUndo}
        canRedo={snapshot.canRedo}
        onUndo={() => void engine.undo()}
        onRedo={() => void engine.redo()}
        onRename={async (title) => {
          const next = await services.renameBoard(title);
          setBoard(next);
        }}
        onlineMembers={onlineMembers}
        onShare={() => setDialog("share")}
        onExport={() => setDialog("export")}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        panelOpen={panelOpen}
        assistantAvailable={Boolean(assistant)}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => (assistantOpen ? closeAssistant() : openAssistant())}
        onComments={() => openComments(null)}
        commentsOpen={panelOpen && panelTab === "comments" && !assistantOpen}
        more={moreActions}
        currentUser={currentUser}
      />

      <DesktopToolbar
        tool={tool}
        onToolChange={changeTool}
        {...selectionActions}
        zoom={camera.zoom}
        onZoomIn={() => zoomTo(1.2)}
        onZoomOut={() => zoomTo(1 / 1.2)}
        onZoomReset={() =>
          setCamera((current) => zoomAt(current, { x: viewport.width / 2, y: viewport.height / 2 }, 1))
        }
        onFit={zoomToFit}
      />

      <div className="relative flex min-h-0 flex-1">
        <main id="main" className="relative min-w-0 flex-1" aria-label={`Board: ${board.title}`}>
          <CanvasStage
            objects={snapshot.objects}
            canEdit={canEdit}
            tool={tool}
            onToolChange={changeTool}
            selectedId={selectedVisible?.id ?? null}
            onSelect={setSelectedId}
            extraSelectedIds={selection.slice(1).map((object) => object.id)}
            onToggleSelect={toggleSelect}
            camera={camera}
            onCameraChange={setCamera}
            onViewportChange={setViewport}
            editingId={editingId}
            onEditingChange={setEditingId}
            cursors={cursors}
            onCreate={(payload) => {
              const timer = startTimer("object_create", { boardId });
              const id = engine.create(payload);
              // The object is drawn optimistically; this measures action to visible feedback.
              if (id) timer.endAfterPaint();
              else timer.end("rejected");
              return id;
            }}
            onMove={(id, position) => {
              const timer = startTimer("object_move", { boardId });
              if (engine.move(id, position)) timer.endAfterPaint();
            }}
            onFirstInteraction={() => {
              if (firstInteraction.current) return;
              firstInteraction.current = true;
              startTimer("canvas_first_interaction", { boardId }).endAfterPaint();
            }}
            onUpdate={(id, changes) => void engine.update(id, changes)}
            onRemove={removeObject}
            onPointerWorld={(point) => services.realtime.sendCursor(point.x, point.y)}
            onContextMenu={(id, at) => setContextMenu({ id, at })}
            onCommentTarget={(id) => {
              if (canComment) openComments(id);
            }}
            ghost={ghostDraft ? { ...ghostDraft.object } : null}
          />

          {/* Blocking sync failure: stays on screen until resolved, so unsaved work is never silently lost. */}
          {snapshot.status === "failed" ? (
            <div
              role="alert"
              className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-card border border-error/40 bg-coral-tint px-4 py-3 text-sm shadow-soft"
            >
              <TriangleAlert className="size-4 shrink-0 text-error" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">Sync failed.</span>{" "}
                {snapshot.failure ? ERROR_CATALOG[snapshot.failure].message : "Your changes can’t be saved right now."}{" "}
                {snapshot.pendingCount > 0
                  ? `${snapshot.pendingCount} ${snapshot.pendingCount === 1 ? "change is" : "changes are"} waiting on this device.`
                  : ""}
              </p>
              {snapshot.failure === "UNAUTHENTICATED" ? (
                <LinkButton href={`/login?next=${encodeURIComponent(`/boards/${boardId}`)}`} size="sm">
                  Log in again
                </LinkButton>
              ) : (
                <Button size="sm" onClick={() => engine.retry()}>
                  Try again
                </Button>
              )}
              {snapshot.pendingCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm("Discard the changes that haven’t been saved? This can’t be undone."))
                      engine.discardPending();
                  }}
                >
                  Discard unsaved changes
                </Button>
              ) : null}
            </div>
          ) : null}

          {selectedVisible && canEdit && !editingId && snapshot.status !== "failed" ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-10 hidden justify-center tablet:flex xl:hidden">
              <div className="pointer-events-auto">
                <ObjectToolbar
                  object={selectedVisible}
                  onStyle={(props: CanvasProps) => void engine.update(selectedVisible.id, { props })}
                  onBringToFront={() => bringToFront(selectedVisible.id)}
                  onDuplicate={() => duplicate(selectedVisible.id)}
                  onDelete={() => removeObject(selectedVisible.id)}
                  onComment={() => openComments(selectedVisible.id)}
                  canComment={canComment}
                  onAskForeman={
                    assistant ? () => openAssistant({ action: "explain_board", context: "object" }) : undefined
                  }
                />
              </div>
            </div>
          ) : null}

          {snapshot.objects.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <p className="font-display text-2xl tracking-tight">This board is empty</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {canEdit
                    ? "Press N and click anywhere to add your first sticky note, or choose a tool on the left."
                    : "Nothing has been added yet. You have view-only access."}
                </p>
              </div>
            </div>
          ) : null}

          <div className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 tablet:block xl:hidden">
            <ToolRail
              tool={tool}
              onToolChange={changeTool}
              canEdit={canEdit}
              onShowShortcuts={() => setDialog("shortcuts")}
            />
          </div>

          <div className="absolute bottom-3 left-3 z-10 max-tablet:top-[calc(max(0.5rem,env(safe-area-inset-top))+4rem)] max-tablet:bottom-auto">
            <ZoomControls
              zoom={camera.zoom}
              onZoomIn={() => zoomTo(1.2)}
              onZoomOut={() => zoomTo(1 / 1.2)}
              onReset={() =>
                setCamera((current) => zoomAt(current, { x: viewport.width / 2, y: viewport.height / 2 }, 1))
              }
              onFit={zoomToFit}
              onShowShortcuts={() => setDialog("shortcuts")}
              connected={realtimeConnected}
              online={online}
            />
          </div>

          {selectedVisible ? (
            <p className="sr-only" aria-live="polite">
              {selection.length > 1
                ? `${selection.length} items selected`
                : `Selected: ${TYPE_LABELS[selectedVisible.type]}`}
            </p>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 tablet:hidden">
            <PhoneToolbar
              tool={tool}
              canEdit={canEdit}
              hasSelection={selection.length > 0}
              assistantAvailable={Boolean(assistant)}
              active={
                phoneSheet ??
                (assistantOpen ? "assistant" : phonePanel ? (panelTab === "outline" ? "outline" : "comments") : null)
              }
              onAdd={() => setPhoneSheet("add")}
              onSelectEdit={() => {
                changeTool("select");
                if (selection.length > 0 && canEdit) setPhoneSheet("edit");
              }}
              onComments={() => openComments(null)}
              onOutline={() => {
                setPanelTab("outline");
                setPanelOpen(true);
                setPhonePanel(true);
                setPhoneSheet(null);
              }}
              onAssistant={() => (assistantOpen ? closeAssistant() : openAssistant())}
              onMore={() => setPhoneSheet("more")}
            />
          </div>
        </main>

        {/* Phone: the panel or Assistant is a bottom sheet over the board, with a scrim. */}
        {(assistant && assistantOpen) || phonePanel ? (
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-scrim tablet:hidden"
            onClick={() => {
              if (assistantOpen) closeAssistant();
              setPhonePanel(false);
            }}
          />
        ) : null}

        {assistant && assistantOpen ? (
          <div className={SHEET_CONTAINER}>
            <AssistantPanel
              services={assistant}
              boardId={boardId}
              canEdit={canEdit}
              online={online}
              objectsById={snapshot.byId}
              selected={selectedVisible ? { id: selectedVisible.id, label: describeObject(selectedVisible) } : null}
              intent={assistantIntent}
              onClose={closeAssistant}
              onPreview={previewAssistant}
              onFocusObject={focusObject}
              onApplied={(operation) => {
                setGhostDraft(null);
                engine.adoptServerCreate(operation);
              }}
              onUndoApplied={(objectId) => engine.undoObject(objectId)}
              onAnnounce={setAnnouncement}
            />
          </div>
        ) : panelOpen || phonePanel ? (
          <div className={cn(SHEET_CONTAINER, !phonePanel && "max-tablet:hidden", !panelOpen && "tablet:hidden")}>
            <SidePanel
              tab={panelTab}
              onTabChange={setPanelTab}
              onClose={() => {
                setPanelOpen(false);
                setPhonePanel(false);
              }}
              commentCount={comments.items?.length ?? 0}
            >
              {panelTab === "people" ? (
                <PeoplePanel
                  members={members}
                  onlineIds={onlineIds}
                  currentUserId={currentUser.id}
                  isOwner={role === "OWNER"}
                  onInvite={() => setDialog("share")}
                />
              ) : null}
              {panelTab === "activity" ? (
                <ActivityPanel
                  items={activity.items}
                  error={activity.error}
                  hasMore={activity.hasMore}
                  loadingMore={activity.loadingMore}
                  onRetry={() => void loadActivity()}
                  onLoadMore={() => {
                    const last = activity.items?.at(-1);
                    if (!last) return;
                    setActivity((current) => ({ ...current, loadingMore: true }));
                    services.loadActivity(last.created_at).then(
                      (older) =>
                        setActivity((current) => ({
                          items: [...(current.items ?? []), ...older],
                          error: null,
                          hasMore: older.length === ACTIVITY_PAGE_SIZE,
                          loadingMore: false,
                        })),
                      (error: unknown) => {
                        setActivity((current) => ({ ...current, loadingMore: false }));
                        toast.error(errorMessage(error));
                      },
                    );
                  }}
                />
              ) : null}
              {panelTab === "comments" ? (
                <CommentsPanel
                  comments={comments.items}
                  error={comments.error}
                  hasMore={comments.hasMore}
                  loadingMore={comments.loadingMore}
                  onRetry={() => void loadComments()}
                  onLoadMore={() => {
                    const last = comments.items?.at(-1);
                    if (!last) return;
                    setComments((current) => ({ ...current, loadingMore: true }));
                    services.loadComments(last.created_at).then(
                      (older) =>
                        setComments((current) => ({
                          items: [...(current.items ?? []), ...older],
                          error: null,
                          hasMore: older.length === COMMENTS_PAGE_SIZE,
                          loadingMore: false,
                        })),
                      (error: unknown) => {
                        setComments((current) => ({ ...current, loadingMore: false }));
                        toast.error(errorMessage(error));
                      },
                    );
                  }}
                  canComment={canComment}
                  currentUserId={currentUser.id}
                  target={commentTarget && !commentTarget.deleted ? commentTarget : null}
                  onClearTarget={() => setCommentTargetId(null)}
                  objectsById={snapshot.byId}
                  onFocusObject={focusObject}
                  onAdd={async (body, objectId) => {
                    const timer = startTimer("comment_create", { boardId });
                    let created: Awaited<ReturnType<typeof services.addComment>>;
                    try {
                      created = await services.addComment(body, objectId);
                    } catch (error) {
                      timer.end("error", toAppError(error).code);
                      throw error;
                    }
                    timer.endAfterPaint();
                    // The realtime event may arrive first; add only if it has not.
                    setComments((current) =>
                      current.items && !current.items.some((comment) => comment.id === created.id)
                        ? { ...current, items: [created, ...current.items] }
                        : current,
                    );
                  }}
                  onEdit={async (id, body) => {
                    const updated = await services.updateComment(id, body);
                    setComments((current) => ({
                      ...current,
                      items: current.items?.map((comment) => (comment.id === id ? updated : comment)) ?? null,
                    }));
                  }}
                  onDelete={async (id) => {
                    await services.deleteComment(id);
                    setComments((current) => ({
                      ...current,
                      items: current.items?.filter((comment) => comment.id !== id) ?? null,
                    }));
                  }}
                />
              ) : null}
              {panelTab === "outline" ? (
                <OutlinePanel
                  objects={snapshot.objects}
                  selectedId={selectedVisible?.id ?? null}
                  canEdit={canEdit}
                  onSelect={focusObject}
                  onEditText={(id, text) => void engine.update(id, { props: { text } })}
                  onDuplicate={duplicate}
                  onDelete={removeObject}
                  onNudge={nudge}
                />
              ) : null}
            </SidePanel>
          </div>
        ) : null}
      </div>

      {/* Meaningful collaboration events only. Cursor movement is never announced. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <ContextMenu
        position={contextMenu ? contextMenu.at : null}
        items={contextItems}
        label="Canvas actions"
        onClose={() => setContextMenu(null)}
      />
      {role === "OWNER" ? (
        <ShareDialog
          open={dialog === "share"}
          onClose={() => setDialog(null)}
          services={services}
          currentUserId={currentUser.id}
          boardTitle={board.title}
          onChanged={() => void refreshBoard()}
        />
      ) : null}
      <ExportDialog
        open={dialog === "export"}
        onClose={() => setDialog(null)}
        objects={snapshot.objects}
        viewportBounds={viewportBounds}
        boardTitle={board.title}
        onExported={(scope) => services.recordExport(scope)}
      />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
      <CommandPalette open={dialog === "palette"} onClose={() => setDialog(null)} commands={commands} />
      <AddSheet open={phoneSheet === "add"} onClose={() => setPhoneSheet(null)} tool={tool} onToolChange={changeTool} />
      <EditSheet
        open={phoneSheet === "edit" && selection.length > 0}
        onClose={() => setPhoneSheet(null)}
        {...selectionActions}
      />
      <MoreSheet open={phoneSheet === "more"} onClose={() => setPhoneSheet(null)} {...moreActions} />
    </div>
  );
}
