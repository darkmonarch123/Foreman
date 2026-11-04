"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Download,
  Keyboard,
  LayoutDashboard,
  LifeBuoy,
  ListTree,
  Maximize,
  MessageSquare,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { THEME_ICONS, ThemeChoice, chooseTheme } from "@/components/theme/theme-choice";
import { useThemePreference } from "@/components/theme/theme-controller";
import { IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DropdownMenu, type MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { Tooltip } from "@/components/ui/tooltip";
import { ALIGN_LABELS, ALIGN_MODES, type AlignMode } from "@/lib/board/arrange";
import {
  FILL_COLORS,
  FONT_SIZES,
  STROKE_COLORS,
  supportsFill,
  supportsStroke,
  supportsText,
} from "@/lib/board/defaults";
import { TOOLS, type Tool } from "@/lib/board/tools";
import type { CanvasObject, CanvasProps } from "@/lib/board/types";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/board/geometry";
import { cn } from "@/lib/cn";
import { THEME_LABELS } from "@/lib/theme";
import { Swatches } from "./object-toolbar";
import { TOOL_ICONS } from "./tool-rail";

const ALIGN_ICONS: Record<AlignMode, LucideIcon> = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
};

/** The tools that add something to the board, in toolbar order. */
const ADD_TOOLS: Tool[] = ["sticky", "text", "rectangle", "circle", "arrow", "pen", "eraser"];

export interface SelectionActions {
  /** Every selected object, primary first. */
  selection: CanvasObject[];
  canEdit: boolean;
  onStyle: (props: CanvasProps) => void;
  onForward: () => void;
  onBackward: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (mode: AlignMode) => void;
}

export interface MoreActions {
  isOwner: boolean;
  boardId: string;
  onExport: () => void;
  onShare: () => void;
  onShortcuts: () => void;
  onFit: () => void;
}

function Divider() {
  return <span role="separator" aria-orientation="vertical" className="mx-1.5 h-6 w-px shrink-0 bg-line" />;
}

function ToolButton({
  tool,
  active,
  disabled,
  onToolChange,
}: {
  tool: Tool;
  active: boolean;
  disabled: boolean;
  onToolChange: (tool: Tool) => void;
}) {
  const definition = TOOLS.find((entry) => entry.id === tool)!;
  const Icon = TOOL_ICONS[tool];
  const label = tool === "pen" ? "Pen" : definition.label;
  return (
    <Tooltip
      label={disabled ? `${label} (view only)` : label}
      shortcut={disabled ? undefined : definition.shortcut}
      side="bottom"
    >
      <IconButton
        label={label}
        aria-pressed={active}
        aria-keyshortcuts={definition.shortcut}
        aria-disabled={disabled || undefined}
        active={active}
        onClick={() => {
          if (!disabled) onToolChange(tool);
        }}
        className={cn(disabled && "opacity-35 hover:bg-transparent")}
      >
        <Icon className="size-[18px]" aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** Fill, line, text colour and size for the selection; only what every selected item supports. */
export function StyleControls({ selection, onStyle }: Pick<SelectionActions, "selection" | "onStyle">) {
  const primary = selection[0];
  if (!primary) return null;
  const all = (test: (type: CanvasObject["type"]) => boolean) => selection.every((object) => test(object.type));
  return (
    <>
      {all(supportsFill) ? (
        <Swatches label="Fill" colors={FILL_COLORS} value={primary.props.fill} onPick={(fill) => onStyle({ fill })} />
      ) : null}
      {all(supportsStroke) ? (
        <Swatches
          label="Line"
          colors={STROKE_COLORS}
          value={primary.props.stroke}
          onPick={(stroke) => onStyle({ stroke })}
        />
      ) : null}
      {all(supportsText) ? (
        <>
          <Swatches
            label="Text colour"
            colors={STROKE_COLORS}
            value={primary.props.color}
            onPick={(color) => onStyle({ color })}
          />
          <Select
            label="Text size"
            hideLabel
            value={String(primary.props.fontSize ?? 15)}
            onChange={(event) => onStyle({ fontSize: Number(event.target.value) })}
            className="h-8 w-[4.5rem] rounded-lg py-0 pl-2.5 pr-7 text-[13px]"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </>
  );
}

function ArrangeButtons({ selection, onForward, onBackward, onDuplicate, onDelete }: SelectionActions) {
  const single = selection.length === 1;
  return (
    <>
      <Tooltip label="Bring forward" side="bottom">
        <IconButton label="Bring forward" onClick={onForward} disabled={!single}>
          <ArrowUpToLine className="size-[18px]" aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip label="Send backward" side="bottom">
        <IconButton label="Send backward" onClick={onBackward} disabled={!single}>
          <ArrowDownToLine className="size-[18px]" aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip label="Duplicate" shortcut="Ctrl D" side="bottom">
        <IconButton label="Duplicate" onClick={onDuplicate} disabled={selection.length === 0}>
          <Copy className="size-[18px]" aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip label="Delete" shortcut="Del" side="bottom">
        <IconButton label="Delete" onClick={onDelete} disabled={selection.length === 0} className="text-danger">
          <Trash2 className="size-[18px]" aria-hidden />
        </IconButton>
      </Tooltip>
    </>
  );
}

function AlignButtons({ selection, onAlign }: Pick<SelectionActions, "selection" | "onAlign">) {
  const enabled = selection.length >= 2;
  return (
    <>
      {ALIGN_MODES.map((mode) => {
        const Icon = ALIGN_ICONS[mode];
        return (
          <Tooltip
            key={mode}
            label={enabled ? ALIGN_LABELS[mode] : `${ALIGN_LABELS[mode]} (select two or more with Shift)`}
            side="bottom"
          >
            <IconButton label={ALIGN_LABELS[mode]} onClick={() => onAlign(mode)} disabled={!enabled}>
              <Icon className="size-[18px]" aria-hidden />
            </IconButton>
          </Tooltip>
        );
      })}
    </>
  );
}

interface DesktopToolbarProps extends SelectionActions {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
}

/**
 * The full board toolbar on wide screens (from 1280px): select and pan, add, style, arrange,
 * align and zoom, in that order. Narrower screens use the tool rail and floating item bar
 * (tablet) or the bottom toolbar and sheets (phone).
 */
export function DesktopToolbar(props: DesktopToolbarProps) {
  const { tool, onToolChange, canEdit, selection, zoom } = props;
  const editable = canEdit && selection.length > 0;
  const percent = Math.round(zoom * 100);
  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      className="hidden h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-3 xl:flex"
    >
      <div role="group" aria-label="Select and pan" className="flex items-center gap-0.5">
        <ToolButton tool="select" active={tool === "select"} disabled={false} onToolChange={onToolChange} />
        <ToolButton tool="hand" active={tool === "hand"} disabled={false} onToolChange={onToolChange} />
      </div>
      <Divider />
      <div role="group" aria-label="Add" className="flex items-center gap-0.5">
        {ADD_TOOLS.map((id) => (
          <ToolButton key={id} tool={id} active={tool === id} disabled={!canEdit} onToolChange={onToolChange} />
        ))}
        <ToolButton tool="comment" active={tool === "comment"} disabled={false} onToolChange={onToolChange} />
      </div>
      {editable ? (
        <>
          <Divider />
          <div role="group" aria-label="Style" className="flex items-center gap-1.5">
            <StyleControls selection={selection} onStyle={props.onStyle} />
          </div>
          <Divider />
          <div role="group" aria-label="Arrange" className="flex items-center gap-0.5">
            <ArrangeButtons {...props} />
          </div>
          <Divider />
          <div role="group" aria-label="Align" className="flex items-center gap-0.5">
            <AlignButtons selection={selection} onAlign={props.onAlign} />
          </div>
        </>
      ) : null}
      <div role="group" aria-label="Zoom" className="ml-auto flex items-center gap-0.5 pl-3">
        <Tooltip label="Zoom to fit" shortcut="Ctrl 0" side="bottom">
          <IconButton label="Zoom to fit" onClick={props.onFit}>
            <Maximize className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Reset to 100%" side="bottom">
          <button
            type="button"
            onClick={props.onZoomReset}
            aria-label={`Zoom ${percent} percent. Reset to 100 percent`}
            className="h-9 min-w-14 rounded-lg px-2 text-[13px] font-medium tabular-nums hover:bg-ink/6"
          >
            {percent}%
          </button>
        </Tooltip>
        <Tooltip label="Zoom out" shortcut="Ctrl −" side="bottom">
          <IconButton label="Zoom out" onClick={props.onZoomOut} disabled={zoom <= MIN_ZOOM}>
            <Minus className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Zoom in" shortcut="Ctrl +" side="bottom">
          <IconButton label="Zoom in" onClick={props.onZoomIn} disabled={zoom >= MAX_ZOOM}>
            <Plus className="size-[18px]" aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

/** "More" as a menu (tablet and desktop header). */
export function MoreMenu({ isOwner, boardId, onExport, onShare, onShortcuts }: MoreActions) {
  const theme = useThemePreference();
  const router = useRouter();
  const items: MenuItem[] = [
    { id: "export", label: "Export as PNG", icon: <Download />, onSelect: onExport },
    ...(isOwner
      ? [
          { id: "share", label: "Share board", icon: <Share2 />, onSelect: onShare },
          {
            id: "settings",
            label: "Board settings",
            icon: <Settings />,
            onSelect: () => router.push(`/boards/${boardId}/settings`),
          },
        ]
      : []),
    { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, shortcut: "?", onSelect: onShortcuts },
    {
      id: "help",
      label: "Help and what’s new",
      icon: <LifeBuoy />,
      onSelect: () => router.push("/whats-new"),
    },
    ...(["light", "dark", "system"] as const).map((option, index) => ({
      id: `theme-${option}`,
      label: `${THEME_LABELS[option]} theme`,
      icon: THEME_ICONS[option],
      checked: theme === option,
      separated: index === 0,
      onSelect: () => chooseTheme(option),
    })),
  ];
  return (
    <DropdownMenu
      label="More board options"
      items={items}
      trigger={
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm hover:border-line-strong pointer-coarse:h-11"
        >
          <MoreHorizontal className="size-4" aria-hidden />
          More
        </button>
      }
    />
  );
}

// -- phone ---------------------------------------------------------------------------------------

export type PhoneSheet = "add" | "edit" | "more" | null;

interface PhoneToolbarProps {
  tool: Tool;
  canEdit: boolean;
  hasSelection: boolean;
  assistantAvailable: boolean;
  active: "add" | "edit" | "comments" | "outline" | "assistant" | "more" | null;
  onAdd: () => void;
  onSelectEdit: () => void;
  onComments: () => void;
  onOutline: () => void;
  onAssistant: () => void;
  onMore: () => void;
}

function BarButton({
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "flex min-h-touch min-w-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[11px] font-medium leading-none transition-colors disabled:opacity-40 [&_svg]:size-5",
        pressed ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-ink/6",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * The phone toolbar: a bar at the bottom of the screen (above the home indicator) with
 * labelled buttons. Everything else opens as a bottom sheet.
 */
export function PhoneToolbar(props: PhoneToolbarProps) {
  const { active, canEdit, hasSelection, assistantAvailable } = props;
  return (
    <nav
      aria-label="Board actions"
      className="pointer-events-auto mx-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-stretch gap-touch-gap rounded-sheet border border-line bg-elevated px-2 py-1.5 shadow-lift tablet:hidden"
    >
      <BarButton
        label="Add"
        icon={<Plus aria-hidden />}
        pressed={active === "add"}
        disabled={!canEdit}
        onClick={props.onAdd}
      />
      <BarButton
        label={hasSelection && canEdit ? "Edit" : "Select"}
        icon={<MousePointer2 aria-hidden />}
        pressed={active === "edit" || (active === null && props.tool === "select")}
        onClick={props.onSelectEdit}
      />
      <BarButton
        label="Comments"
        icon={<MessageSquare aria-hidden />}
        pressed={active === "comments"}
        onClick={props.onComments}
      />
      <BarButton
        label="Outline"
        icon={<ListTree aria-hidden />}
        pressed={active === "outline"}
        onClick={props.onOutline}
      />
      {assistantAvailable ? (
        <BarButton
          label="Assistant"
          icon={<Sparkles aria-hidden />}
          pressed={active === "assistant"}
          onClick={props.onAssistant}
        />
      ) : null}
      <BarButton
        label="More"
        icon={<MoreHorizontal aria-hidden />}
        pressed={active === "more"}
        onClick={props.onMore}
      />
    </nav>
  );
}

function SheetAction({
  label,
  icon,
  onClick,
  danger,
  disabled,
  pressed,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-control border px-2 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-40 [&_svg]:size-5",
        pressed ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface hover:border-line-strong",
        danger && "text-danger",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Add sheet: one tap picks a tool, then a tap on the board places or draws it. */
export function AddSheet({
  open,
  onClose,
  tool,
  onToolChange,
}: {
  open: boolean;
  onClose: () => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to the board"
      variant="sheet"
      description="Choose what to add, then tap the board."
    >
      <div className="grid grid-cols-3 gap-touch-gap">
        {ADD_TOOLS.map((id) => {
          const Icon = TOOL_ICONS[id];
          const label = TOOLS.find((entry) => entry.id === id)!.label;
          return (
            <SheetAction
              key={id}
              label={label}
              icon={<Icon aria-hidden />}
              pressed={tool === id}
              onClick={() => {
                onToolChange(id);
                onClose();
              }}
            />
          );
        })}
        <SheetAction
          label="Pan"
          icon={(() => {
            const Icon = TOOL_ICONS.hand;
            return <Icon aria-hidden />;
          })()}
          pressed={tool === "hand"}
          onClick={() => {
            onToolChange("hand");
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}

/** Edit sheet: the phone version of the style, arrange and align groups. */
export function EditSheet({
  open,
  onClose,
  ...actions
}: SelectionActions & { open: boolean; onClose: () => void; onComment?: () => void }) {
  const { selection, onAlign } = actions;
  const count = selection.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      title={count > 1 ? `${count} items selected` : "Edit item"}
      description="Tip: press and hold an item for more actions."
    >
      <div className="flex flex-col gap-5">
        <div role="group" aria-label="Style" className="flex flex-wrap items-center gap-3">
          <StyleControls selection={selection} onStyle={actions.onStyle} />
        </div>
        <div role="group" aria-label="Arrange" className="grid grid-cols-4 gap-touch-gap">
          <SheetAction
            label="Forward"
            icon={<ArrowUpToLine aria-hidden />}
            onClick={actions.onForward}
            disabled={count !== 1}
          />
          <SheetAction
            label="Backward"
            icon={<ArrowDownToLine aria-hidden />}
            onClick={actions.onBackward}
            disabled={count !== 1}
          />
          <SheetAction label="Duplicate" icon={<Copy aria-hidden />} onClick={actions.onDuplicate} />
          <SheetAction
            label="Delete"
            danger
            icon={<Trash2 aria-hidden />}
            onClick={() => {
              actions.onDelete();
              onClose();
            }}
          />
        </div>
        {count >= 2 ? (
          <div role="group" aria-label="Align" className="grid grid-cols-3 gap-touch-gap">
            {ALIGN_MODES.map((mode) => {
              const Icon = ALIGN_ICONS[mode];
              return (
                <SheetAction
                  key={mode}
                  label={ALIGN_LABELS[mode].replace("Align ", "")}
                  icon={<Icon aria-hidden />}
                  onClick={() => onAlign(mode)}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** More sheet (phone): export, sharing, settings, shortcuts, help and theme, each labelled. */
export function MoreSheet({
  open,
  onClose,
  isOwner,
  boardId,
  onExport,
  onShare,
  onShortcuts,
  onFit,
}: MoreActions & { open: boolean; onClose: () => void }) {
  const then = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <Modal open={open} onClose={onClose} variant="sheet" title="More">
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-touch-gap">
          <SheetAction label="Export" icon={<Download aria-hidden />} onClick={then(onExport)} />
          {isOwner ? <SheetAction label="Share" icon={<Share2 aria-hidden />} onClick={then(onShare)} /> : null}
          <SheetAction label="Zoom to fit" icon={<Maximize aria-hidden />} onClick={then(onFit)} />
          {isOwner ? (
            <Link
              href={`/boards/${boardId}/settings`}
              className="flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-2 py-2.5 text-[13px] font-medium hover:border-line-strong [&_svg]:size-5"
            >
              <Settings aria-hidden />
              Board settings
            </Link>
          ) : null}
          <SheetAction label="Shortcuts" icon={<Keyboard aria-hidden />} onClick={then(onShortcuts)} />
          <Link
            href="/whats-new"
            className="flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-2 py-2.5 text-[13px] font-medium hover:border-line-strong [&_svg]:size-5"
          >
            <LifeBuoy aria-hidden />
            Help
          </Link>
          <Link
            href="/dashboard"
            className="flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-2 py-2.5 text-[13px] font-medium hover:border-line-strong [&_svg]:size-5"
          >
            <LayoutDashboard aria-hidden />
            Dashboard
          </Link>
        </div>
        <ThemeChoice />
      </div>
    </Modal>
  );
}
