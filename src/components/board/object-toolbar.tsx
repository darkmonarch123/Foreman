"use client";

import { Bold, BringToFront, Copy, MessageSquarePlus, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import {
  FILL_COLORS,
  FONT_SIZES,
  STROKE_COLORS,
  TYPE_LABELS,
  supportsFill,
  supportsStroke,
  supportsText,
} from "@/lib/board/defaults";
import type { CanvasObject, CanvasProps } from "@/lib/board/types";
import { cn } from "@/lib/cn";

interface ObjectToolbarProps {
  object: CanvasObject;
  onStyle: (props: CanvasProps) => void;
  onBringToFront: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onComment: () => void;
  canComment: boolean;
}

function Swatches({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly { value: string; label: string }[];
  value: string | undefined;
  onPick: (color: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {colors.map((color) => {
        const active = value?.toUpperCase() === color.value;
        return (
          <button
            key={color.value}
            type="button"
            title={`${label}: ${color.label}`}
            aria-label={`${label}: ${color.label}`}
            aria-pressed={active}
            onClick={() => onPick(color.value)}
            className={cn(
              "size-6 rounded-full border transition-transform hover:scale-110",
              active ? "border-ink ring-2 ring-ink ring-offset-2 ring-offset-surface" : "border-line-strong",
            )}
            style={{ backgroundColor: color.value }}
          />
        );
      })}
    </div>
  );
}

/** Appears when one object is selected and the person can edit. */
export function ObjectToolbar({
  object,
  onStyle,
  onBringToFront,
  onDuplicate,
  onDelete,
  onComment,
  canComment,
}: ObjectToolbarProps) {
  const divider = <span role="separator" aria-orientation="vertical" className="mx-1 h-6 w-px bg-line" />;
  return (
    <div
      role="toolbar"
      aria-label={`${TYPE_LABELS[object.type]} options`}
      className="flex max-w-full flex-wrap items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 shadow-soft"
    >
      {supportsFill(object.type) ? (
        <>
          <Swatches label="Fill" colors={FILL_COLORS} value={object.props.fill} onPick={(fill) => onStyle({ fill })} />
          {divider}
        </>
      ) : null}
      {supportsStroke(object.type) ? (
        <>
          <Swatches
            label="Line"
            colors={STROKE_COLORS}
            value={object.props.stroke}
            onPick={(stroke) => onStyle({ stroke })}
          />
          {divider}
        </>
      ) : null}
      {supportsText(object.type) ? (
        <>
          <Select
            label="Text size"
            hideLabel
            value={String(object.props.fontSize ?? 15)}
            onChange={(event) => onStyle({ fontSize: Number(event.target.value) })}
            className="h-8 w-[4.5rem] rounded-lg py-0 pl-2.5 pr-7 text-[13px]"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
          <Tooltip label="Bold" side="bottom">
            <IconButton
              label="Bold"
              size="sm"
              aria-pressed={object.props.bold === true}
              active={object.props.bold === true}
              onClick={() => onStyle({ bold: !object.props.bold })}
            >
              <Bold className="size-4" aria-hidden />
            </IconButton>
          </Tooltip>
          {divider}
        </>
      ) : null}
      <Tooltip label="Bring to front" side="bottom">
        <IconButton label="Bring to front" size="sm" onClick={onBringToFront}>
          <BringToFront className="size-4" aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip label="Duplicate" side="bottom">
        <IconButton label="Duplicate" size="sm" onClick={onDuplicate}>
          <Copy className="size-4" aria-hidden />
        </IconButton>
      </Tooltip>
      {canComment ? (
        <Tooltip label="Comment on this item" side="bottom">
          <IconButton label="Comment on this item" size="sm" onClick={onComment}>
            <MessageSquarePlus className="size-4" aria-hidden />
          </IconButton>
        </Tooltip>
      ) : null}
      <Tooltip label="Delete" side="bottom">
        <IconButton label="Delete" size="sm" onClick={onDelete} className="text-error">
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </Tooltip>
    </div>
  );
}
