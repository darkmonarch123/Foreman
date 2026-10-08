"use client";

import {
  Circle,
  Eraser,
  Hand,
  Keyboard,
  LayoutTemplate,
  MessageSquare,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Square,
  StickyNote,
  Type,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { TOOLS, type Tool } from "@/lib/board/tools";
import { cn } from "@/lib/cn";

const ICONS: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  hand: Hand,
  pen: Pencil,
  eraser: Eraser,
  sticky: StickyNote,
  text: Type,
  rectangle: Square,
  circle: Circle,
  arrow: MoveUpRight,
  comment: MessageSquare,
};

interface ToolRailProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  canEdit: boolean;
  onShowShortcuts: () => void;
}

/**
 * The left tool rail. There is deliberately no image tool: image upload is
 * hidden until secure upload validation exists (see docs/security.md).
 */
export function ToolRail({ tool, onToolChange, canEdit, onShowShortcuts }: ToolRailProps) {
  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="vertical"
      className="flex flex-col items-center gap-1 rounded-card border border-line bg-surface p-1.5 shadow-soft"
    >
      {TOOLS.map((definition, index) => {
        const Icon = ICONS[definition.id];
        const disabled = definition.requiresEdit && !canEdit;
        const active = tool === definition.id;
        return (
          <div key={definition.id} className="contents">
            {index === 2 || index === 9 ? <span role="separator" className="my-0.5 h-px w-6 bg-line" /> : null}
            <Tooltip
              label={disabled ? `${definition.label} (view only)` : definition.label}
              shortcut={disabled ? undefined : definition.shortcut}
              side="right"
            >
              <button
                type="button"
                aria-label={definition.label}
                aria-pressed={active}
                aria-keyshortcuts={definition.shortcut}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled) onToolChange(definition.id);
                }}
                className={cn(
                  "inline-flex size-10 items-center justify-center rounded-control transition-colors duration-150",
                  active ? "bg-ink text-white" : "text-ink hover:bg-ink/6",
                  disabled && "opacity-35 hover:bg-transparent",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
              </button>
            </Tooltip>
          </div>
        );
      })}
      <span role="separator" className="my-0.5 h-px w-6 bg-line" />
      <Tooltip label="Start a new board from a template" side="right">
        <Link
          href="/templates"
          aria-label="Templates"
          className="inline-flex size-10 items-center justify-center rounded-control text-ink hover:bg-ink/6"
        >
          <LayoutTemplate className="size-[18px]" aria-hidden />
        </Link>
      </Tooltip>
      <Tooltip label="Keyboard shortcuts" shortcut="?" side="right">
        <button
          type="button"
          aria-label="Help and keyboard shortcuts"
          onClick={onShowShortcuts}
          className="inline-flex size-10 items-center justify-center rounded-control text-ink hover:bg-ink/6"
        >
          <Keyboard className="size-[18px]" aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
