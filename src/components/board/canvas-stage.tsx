"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FONT_STACK,
  LINE_HEIGHT,
  TEXT_PADDING,
  defaultPayload,
  supportsResize,
  supportsText,
} from "@/lib/board/defaults";
import {
  objectBounds,
  pointsToPath,
  resizeBounds,
  screenToWorld,
  simplifyStroke,
  strokeToObject,
  worldToScreen,
  zoomAt,
  type Bounds,
  type Camera,
  type Point,
  type ResizeHandle,
} from "@/lib/board/geometry";
import { TOOL_OBJECT_TYPE, isTypingTarget, type Tool } from "@/lib/board/tools";
import type { CanvasObject, CreatePayload, UpdatePayload } from "@/lib/board/types";
import { cn } from "@/lib/cn";
import { ObjectShape } from "./object-shape";

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface CanvasStageProps {
  objects: CanvasObject[];
  canEdit: boolean;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  onViewportChange: (size: { width: number; height: number }) => void;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
  cursors: RemoteCursor[];
  onCreate: (payload: CreatePayload) => string | null;
  onMove: (id: string, position: Point) => void;
  onUpdate: (id: string, changes: UpdatePayload) => void;
  onRemove: (id: string) => void;
  onPointerWorld: (point: Point) => void;
  onContextMenu: (id: string | null, screen: Point) => void;
  onCommentTarget: (id: string | null) => void;
}

type Interaction =
  | { kind: "pan"; startScreen: Point; startCamera: Camera }
  | { kind: "drag"; id: string; startWorld: Point; origin: Point; moved: boolean }
  | { kind: "resize"; id: string; handle: ResizeHandle; startWorld: Point; start: Bounds }
  | { kind: "arrow-end"; id: string; end: "from" | "to"; object: CanvasObject }
  | { kind: "shape"; type: "RECTANGLE" | "CIRCLE" | "ARROW"; start: Point }
  | { kind: "place"; type: "STICKY_NOTE" | "TEXT" }
  | { kind: "pen"; points: Point[] }
  | { kind: "erase" };

type Preview = Partial<Pick<CanvasObject, "x" | "y" | "width" | "height">> & { id: string };

const CLICK_SLOP = 5;

function objectIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<SVGGElement>("[data-object-id]")?.dataset.objectId ?? null;
}

export function CanvasStage({
  objects,
  canEdit,
  tool,
  onToolChange,
  selectedId,
  onSelect,
  camera,
  onCameraChange,
  onViewportChange,
  editingId,
  onEditingChange,
  cursors,
  onCreate,
  onMove,
  onUpdate,
  onRemove,
  onPointerWorld,
  onContextMenu,
  onCommentTarget,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const cameraRef = useRef(camera);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<
    { kind: "pen"; points: Point[] } | { kind: "shape"; type: string; from: Point; to: Point } | null
  >(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const selected = selectedId ? (objects.find((object) => object.id === selectedId) ?? null) : null;
  const editing = editingId ? (objects.find((object) => object.id === editingId) ?? null) : null;

  // -- viewport size -----------------------------------------------------------
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const report = () => onViewportChange({ width: element.clientWidth, height: element.clientHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onViewportChange]);

  // -- wheel: pan, or zoom with Ctrl/Cmd (also what a trackpad pinch sends) -----
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = element!.getBoundingClientRect();
        const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        onCameraChange(zoomAt(current, anchor, current.zoom * Math.exp(-event.deltaY * 0.0022)));
      } else {
        onCameraChange({
          ...current,
          x: current.x + event.deltaX / current.zoom,
          y: current.y + event.deltaY / current.zoom,
        });
      }
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onCameraChange]);

  // -- hold Space to pan ---------------------------------------------------------
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !isTypingTarget(event.target) && !event.repeat) {
        const active = document.activeElement;
        // Leave Space alone when it would activate a focused control.
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          active.closest("button, a, [role='tab'], [role='menuitem']")
        )
          return;
        event.preventDefault();
        setSpaceHeld(true);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const toScreen = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Point => screenToWorld(cameraRef.current, toScreen(event)),
    [toScreen],
  );

  // -- pointer handling -------------------------------------------------------------
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 2) return;
    if (editingId) return; // the text editor handles its own blur/commit
    const screen = toScreen(event);
    const world = toWorld(event);
    const hitId = objectIdAt(event.target);
    const element = event.currentTarget;

    const begin = (next: Interaction) => {
      interaction.current = next;
      element.setPointerCapture(event.pointerId);
    };

    if (event.button === 1 || tool === "hand" || spaceHeld) {
      event.preventDefault();
      setPanning(true);
      begin({ kind: "pan", startScreen: screen, startCamera: cameraRef.current });
      return;
    }
    if (event.button !== 0) return;

    if (tool === "select") {
      if (hitId) {
        onSelect(hitId);
        const target = objects.find((object) => object.id === hitId);
        if (canEdit && target) {
          begin({ kind: "drag", id: hitId, startWorld: world, origin: { x: target.x, y: target.y }, moved: false });
        }
      } else {
        onSelect(null);
        setPanning(true);
        begin({ kind: "pan", startScreen: screen, startCamera: cameraRef.current });
      }
      return;
    }

    if (tool === "comment") {
      onCommentTarget(hitId);
      if (hitId) onSelect(hitId);
      onToolChange("select");
      return;
    }

    if (!canEdit) return;

    if (tool === "eraser") {
      if (hitId) onRemove(hitId);
      begin({ kind: "erase" });
      return;
    }
    if (tool === "pen") {
      begin({ kind: "pen", points: [world] });
      setDraft({ kind: "pen", points: [world] });
      return;
    }
    if (tool === "sticky" || tool === "text") {
      // Placed on release, not on press: the browser moves focus on mouse down,
      // which would immediately close the text editor that opens for the new item.
      begin({ kind: "place", type: TOOL_OBJECT_TYPE[tool] as "STICKY_NOTE" | "TEXT" });
      return;
    }
    if (tool === "rectangle" || tool === "circle" || tool === "arrow") {
      const type = TOOL_OBJECT_TYPE[tool] as "RECTANGLE" | "CIRCLE" | "ARROW";
      begin({ kind: "shape", type, start: world });
      setDraft({ kind: "shape", type, from: world, to: world });
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const world = toWorld(event);
    onPointerWorld(world);
    const current = interaction.current;
    if (!current) return;

    switch (current.kind) {
      case "pan": {
        const screen = toScreen(event);
        const { startCamera, startScreen } = current;
        onCameraChange({
          zoom: startCamera.zoom,
          x: startCamera.x - (screen.x - startScreen.x) / startCamera.zoom,
          y: startCamera.y - (screen.y - startScreen.y) / startCamera.zoom,
        });
        break;
      }
      case "drag": {
        const dx = world.x - current.startWorld.x;
        const dy = world.y - current.startWorld.y;
        if (!current.moved && Math.hypot(dx, dy) * cameraRef.current.zoom < CLICK_SLOP) break;
        current.moved = true;
        setPreview({ id: current.id, x: Math.round(current.origin.x + dx), y: Math.round(current.origin.y + dy) });
        break;
      }
      case "resize": {
        const next = resizeBounds(
          current.start,
          current.handle,
          world.x - current.startWorld.x,
          world.y - current.startWorld.y,
        );
        setPreview({ id: current.id, ...next });
        break;
      }
      case "arrow-end": {
        const { object } = current;
        const from = current.end === "from" ? world : { x: object.x, y: object.y };
        const to = current.end === "to" ? world : { x: object.x + object.width, y: object.y + object.height };
        setPreview({
          id: current.id,
          x: Math.round(from.x),
          y: Math.round(from.y),
          width: Math.round(to.x - from.x),
          height: Math.round(to.y - from.y),
        });
        break;
      }
      case "shape": {
        setDraft({ kind: "shape", type: current.type, from: current.start, to: world });
        break;
      }
      case "pen": {
        current.points.push(world);
        setDraft({ kind: "pen", points: [...current.points] });
        break;
      }
      case "erase": {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const id = objectIdAt(element);
        if (id) onRemove(id);
        break;
      }
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = interaction.current;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
    if (!current) return;
    const world = toWorld(event);

    switch (current.kind) {
      case "drag": {
        if (current.moved && preview?.id === current.id && preview.x !== undefined && preview.y !== undefined) {
          onMove(current.id, { x: preview.x, y: preview.y });
        }
        break;
      }
      case "resize":
      case "arrow-end": {
        if (preview?.id === current.id) {
          const { id: _id, ...changes } = preview;
          void _id;
          onUpdate(current.id, changes);
        }
        break;
      }
      case "shape": {
        const dx = world.x - current.start.x;
        const dy = world.y - current.start.y;
        const dragged = Math.hypot(dx, dy) * cameraRef.current.zoom >= CLICK_SLOP * 2;
        let payload = defaultPayload(current.type, current.start);
        if (dragged) {
          if (current.type === "ARROW") {
            payload = {
              ...payload,
              x: Math.round(current.start.x),
              y: Math.round(current.start.y),
              width: Math.round(dx),
              height: Math.round(dy),
            };
          } else {
            payload = {
              ...payload,
              x: Math.round(Math.min(current.start.x, world.x)),
              y: Math.round(Math.min(current.start.y, world.y)),
              width: Math.max(24, Math.round(Math.abs(dx))),
              height: Math.max(24, Math.round(Math.abs(dy))),
            };
          }
        }
        const id = onCreate(payload);
        if (id) onSelect(id);
        onToolChange("select");
        break;
      }
      case "place": {
        const id = onCreate(defaultPayload(current.type, world));
        if (id) {
          onSelect(id);
          onEditingChange(id);
        }
        onToolChange("select");
        break;
      }
      case "pen": {
        const stroke = strokeToObject(simplifyStroke(current.points, 1.5 / cameraRef.current.zoom));
        const base = defaultPayload("DRAWING", current.points[0]);
        onCreate({
          ...base,
          x: stroke.x,
          y: stroke.y,
          width: stroke.width,
          height: stroke.height,
          props: { ...base.props, points: stroke.points },
        });
        break;
      }
      default:
        break;
    }
    setPreview(null);
    setDraft(null);
  }

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, handle: ResizeHandle) => {
      if (!selected || !canEdit) return;
      event.stopPropagation();
      event.preventDefault();
      interaction.current = {
        kind: "resize",
        id: selected.id,
        handle,
        startWorld: toWorld(event),
        start: objectBounds(selected),
      };
      containerRef.current?.setPointerCapture(event.pointerId);
    },
    [selected, canEdit, toWorld],
  );

  const startArrowEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>, end: "from" | "to") => {
      if (!selected || !canEdit) return;
      event.stopPropagation();
      event.preventDefault();
      interaction.current = { kind: "arrow-end", id: selected.id, end, object: selected };
      containerRef.current?.setPointerCapture(event.pointerId);
    },
    [selected, canEdit],
  );

  // -- derived geometry ------------------------------------------------------------
  const withPreview = (object: CanvasObject): CanvasObject =>
    preview && preview.id === object.id ? { ...object, ...preview } : object;

  const selectedView = selected ? withPreview(selected) : null;
  const selectionBox = selectedView
    ? (() => {
        const bounds = objectBounds(selectedView);
        const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
        return {
          left: topLeft.x,
          top: topLeft.y,
          width: bounds.width * camera.zoom,
          height: bounds.height * camera.zoom,
        };
      })()
    : null;

  const gridSize = 24 * camera.zoom;
  const cursorClass = panning
    ? "cursor-grabbing"
    : tool === "hand" || spaceHeld
      ? "cursor-grab"
      : tool === "select"
        ? "cursor-default"
        : tool === "comment"
          ? "cursor-help"
          : "cursor-crosshair";

  return (
    <div
      ref={containerRef}
      data-testid="canvas-stage"
      className={cn("canvas-grid relative size-full touch-none select-none overflow-hidden", cursorClass)}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`,
        // Dots become noise when zoomed far out.
        backgroundImage: camera.zoom < 0.4 ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        // Pointer capture retargets click events to this container, so look up
        // what is actually under the pointer.
        const id = objectIdAt(document.elementFromPoint(event.clientX, event.clientY));
        const target = id ? objects.find((object) => object.id === id) : null;
        if (canEdit && target && supportsText(target.type) && tool === "select") {
          onSelect(target.id);
          onEditingChange(target.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const id = objectIdAt(event.target);
        if (id) onSelect(id);
        onContextMenu(id, { x: event.clientX, y: event.clientY });
      }}
    >
      <svg
        className="absolute inset-0 size-full"
        role="group"
        aria-label="Board canvas. The Outline panel lists every item for keyboard and screen-reader use."
      >
        <g transform={`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`}>
          {objects.map((object) => (
            <CanvasObjectView key={object.id} object={withPreview(object)} hideText={editingId === object.id} />
          ))}
          {draft?.kind === "pen" ? (
            <path
              d={pointsToPath(draft.points.flatMap((point) => [point.x, point.y]))}
              fill="none"
              stroke="#121212"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ) : null}
          {draft?.kind === "shape" ? (
            draft.type === "ARROW" ? (
              <line
                x1={draft.from.x}
                y1={draft.from.y}
                x2={draft.to.x}
                y2={draft.to.y}
                stroke="#2563EB"
                strokeWidth={2 / camera.zoom}
                pointerEvents="none"
              />
            ) : draft.type === "CIRCLE" ? (
              <ellipse
                cx={(draft.from.x + draft.to.x) / 2}
                cy={(draft.from.y + draft.to.y) / 2}
                rx={Math.abs(draft.to.x - draft.from.x) / 2}
                ry={Math.abs(draft.to.y - draft.from.y) / 2}
                fill="#2563EB14"
                stroke="#2563EB"
                strokeWidth={1.5 / camera.zoom}
                pointerEvents="none"
              />
            ) : (
              <rect
                x={Math.min(draft.from.x, draft.to.x)}
                y={Math.min(draft.from.y, draft.to.y)}
                width={Math.abs(draft.to.x - draft.from.x)}
                height={Math.abs(draft.to.y - draft.from.y)}
                rx={10}
                fill="#2563EB14"
                stroke="#2563EB"
                strokeWidth={1.5 / camera.zoom}
                pointerEvents="none"
              />
            )
          ) : null}
        </g>
      </svg>

      {/* Selection outline and handles, in screen space so they do not scale with zoom. */}
      {selectionBox && selectedView && !editing ? (
        selectedView.type === "ARROW" ? (
          canEdit ? (
            <>
              {(["from", "to"] as const).map((end) => {
                const point = worldToScreen(
                  camera,
                  end === "from"
                    ? { x: selectedView.x, y: selectedView.y }
                    : { x: selectedView.x + selectedView.width, y: selectedView.y + selectedView.height },
                );
                return (
                  <span
                    key={end}
                    data-handle={`arrow-${end}`}
                    onPointerDown={(event) => startArrowEnd(event, end)}
                    className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-focus bg-white"
                    style={{ left: point.x, top: point.y }}
                  />
                );
              })}
            </>
          ) : null
        ) : (
          <div
            data-testid="selection-box"
            className="pointer-events-none absolute rounded-[3px] border-[1.5px] border-focus"
            style={{
              left: selectionBox.left - 3,
              top: selectionBox.top - 3,
              width: selectionBox.width + 6,
              height: selectionBox.height + 6,
            }}
          >
            {canEdit && supportsResize(selectedView.type) ? <ResizeHandles onStart={startResize} /> : null}
          </div>
        )
      ) : null}

      {editing ? (
        <TextEditor
          key={editing.id}
          object={editing}
          camera={camera}
          onCommit={(text, height) => {
            onEditingChange(null);
            const changes: UpdatePayload = {};
            if (text !== (editing.props.text ?? "")) changes.props = { text };
            if (editing.type === "TEXT" && height && Math.abs(height - editing.height) > 1) changes.height = height;
            if (changes.props || changes.height) onUpdate(editing.id, changes);
          }}
          onCancel={() => onEditingChange(null)}
        />
      ) : null}

      {/* Remote cursors: live, never stored, and not announced to assistive technology. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {cursors.map((cursor) => {
          const point = worldToScreen(camera, cursor);
          return (
            <div
              key={cursor.userId}
              data-testid="remote-cursor"
              className="absolute left-0 top-0 transition-transform duration-100 ease-linear"
              style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
            >
              <svg width="18" height="22" viewBox="0 0 18 22" className="block">
                <path
                  d="M1 1v17l5-4.6 3.6 7.6 3-1.4-3.6-7.5H16z"
                  fill={cursor.color}
                  stroke="#fff"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="ml-3 inline-block max-w-40 truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResizeHandles({
  onStart,
}: {
  onStart: (event: ReactPointerEvent<HTMLElement>, handle: ResizeHandle) => void;
}) {
  return (
    <>
      {(["nw", "ne", "sw", "se"] as const).map((handle) => (
        <span
          key={handle}
          data-handle={handle}
          onPointerDown={(event) => onStart(event, handle)}
          className={cn(
            "pointer-events-auto absolute size-3 rounded-[3px] border-[1.5px] border-focus bg-white",
            handle === "nw" && "-left-1.5 -top-1.5 cursor-nwse-resize",
            handle === "ne" && "-right-1.5 -top-1.5 cursor-nesw-resize",
            handle === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
            handle === "se" && "-bottom-1.5 -right-1.5 cursor-nwse-resize",
          )}
        />
      ))}
    </>
  );
}

/** Memoised: an object re-renders only when its own data changes, not on every pan, zoom or cursor update. */
const CanvasObjectView = memo(function CanvasObjectView({
  object,
  hideText,
}: {
  object: CanvasObject;
  hideText: boolean;
}) {
  return (
    <g data-object-id={object.id} data-object-type={object.type}>
      <ObjectShape object={object} hideText={hideText} />
    </g>
  );
});

interface TextEditorProps {
  object: CanvasObject;
  camera: Camera;
  onCommit: (text: string, heightInWorld: number | null) => void;
  onCancel: () => void;
}

/** In-place text editing. The value is plain text; it is never interpreted as markup. */
function TextEditor({ object, camera, onCommit, onCancel }: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const committed = useRef(false);
  const bounds = objectBounds(object);
  const origin = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const fontSize = (object.props.fontSize ?? 15) * camera.zoom;
  const isText = object.type === "TEXT";
  const centered = object.type === "RECTANGLE" || object.type === "CIRCLE";
  const padding = isText ? 0 : TEXT_PADDING * camera.zoom;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  function commit() {
    if (committed.current) return;
    committed.current = true;
    const element = ref.current;
    if (!element) return;
    const height = isText ? Math.max(24, Math.round(element.scrollHeight / camera.zoom)) : null;
    onCommit(element.value.slice(0, 5000), height);
  }

  return (
    <textarea
      ref={ref}
      aria-label={`Text for ${object.type === "STICKY_NOTE" ? "sticky note" : object.type.toLowerCase()}`}
      defaultValue={object.props.text ?? ""}
      maxLength={5000}
      spellCheck
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (cancelled.current) onCancel();
        else commit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className="absolute resize-none overflow-hidden bg-transparent outline-2 outline-offset-2 outline-focus"
      style={{
        left: origin.x,
        top: origin.y,
        width: Math.max(40, bounds.width * camera.zoom),
        height: Math.max(fontSize * LINE_HEIGHT + padding * 2, bounds.height * camera.zoom),
        padding,
        fontFamily: FONT_STACK,
        fontSize,
        fontWeight: object.props.bold ? 600 : 400,
        lineHeight: LINE_HEIGHT,
        color: object.props.color ?? "#121212",
        textAlign: object.props.textAlign ?? (centered ? "center" : "left"),
        borderRadius: 6,
      }}
    />
  );
}
