"use client";

import { Keyboard, Maximize, Minus, Plus, Wifi, WifiOff } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/board/geometry";

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  onShowShortcuts: () => void;
  /** Whether the realtime connection is up. */
  connected: boolean;
  online: boolean;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onShowShortcuts,
  connected,
  online,
}: ZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const connection = !online ? "Offline" : connected ? "Connected" : "Reconnecting";
  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Zoom"
        className="flex items-center rounded-card border border-line bg-surface p-1 shadow-soft"
      >
        <Tooltip label="Zoom out">
          <IconButton label="Zoom out" size="sm" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM}>
            <Minus className="size-4" aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Reset to 100%">
          <button
            type="button"
            onClick={onReset}
            aria-label={`Zoom ${percent} percent. Reset to 100 percent`}
            className="h-8 min-w-14 rounded-lg px-2 text-[13px] font-medium tabular-nums hover:bg-ink/6"
          >
            {percent}%
          </button>
        </Tooltip>
        <Tooltip label="Zoom in">
          <IconButton label="Zoom in" size="sm" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM}>
            <Plus className="size-4" aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Zoom to fit">
          <IconButton label="Zoom to fit" size="sm" onClick={onFit}>
            <Maximize className="size-4" aria-hidden />
          </IconButton>
        </Tooltip>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex h-10 items-center gap-2 rounded-card border border-line bg-surface px-3 text-[13px] shadow-soft"
      >
        {online && connected ? (
          <Wifi className="size-4 text-success" aria-hidden />
        ) : (
          <WifiOff className="size-4 text-warning" aria-hidden />
        )}
        {connection}
      </div>

      <Tooltip label="Keyboard shortcuts" shortcut="?">
        <IconButton
          label="Keyboard shortcuts"
          onClick={onShowShortcuts}
          className="rounded-card border border-line bg-surface shadow-soft"
        >
          <Keyboard className="size-4" aria-hidden />
        </IconButton>
      </Tooltip>
    </div>
  );
}
