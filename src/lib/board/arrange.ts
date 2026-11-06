import type { CanvasObject } from "./types";

type Box = Pick<CanvasObject, "id" | "x" | "y" | "width" | "height">;
type Layered = Pick<CanvasObject, "id" | "z_index">;

export const ALIGN_MODES = ["left", "center", "right", "top", "middle", "bottom"] as const;
export type AlignMode = (typeof ALIGN_MODES)[number];

export const ALIGN_LABELS: Record<AlignMode, string> = {
  left: "Align left",
  center: "Align centre",
  right: "Align right",
  top: "Align top",
  middle: "Align middle",
  bottom: "Align bottom",
};

/** Arrows store a direction in width/height (which can be negative); measure their real box. */
function bounds(object: Box) {
  const left = Math.min(object.x, object.x + object.width);
  const top = Math.min(object.y, object.y + object.height);
  return { left, top, right: left + Math.abs(object.width), bottom: top + Math.abs(object.height) };
}

/**
 * New positions that line up two or more objects against the edge or centre of their combined
 * bounds. Only objects that actually move are returned, rounded to whole units.
 */
export function alignObjects(objects: readonly Box[], mode: AlignMode): { id: string; x: number; y: number }[] {
  if (objects.length < 2) return [];
  const boxes = objects.map((object) => ({ object, box: bounds(object) }));
  const left = Math.min(...boxes.map(({ box }) => box.left));
  const right = Math.max(...boxes.map(({ box }) => box.right));
  const top = Math.min(...boxes.map(({ box }) => box.top));
  const bottom = Math.max(...boxes.map(({ box }) => box.bottom));
  const moves: { id: string; x: number; y: number }[] = [];
  for (const { object, box } of boxes) {
    let dx = 0;
    let dy = 0;
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    if (mode === "left") dx = left - box.left;
    if (mode === "right") dx = right - box.right;
    if (mode === "center") dx = (left + right) / 2 - (box.left + width / 2);
    if (mode === "top") dy = top - box.top;
    if (mode === "bottom") dy = bottom - box.bottom;
    if (mode === "middle") dy = (top + bottom) / 2 - (box.top + height / 2);
    const x = Math.round(object.x + dx);
    const y = Math.round(object.y + dy);
    if (x !== object.x || y !== object.y) moves.push({ id: object.id, x, y });
  }
  return moves;
}

/**
 * Moves one object a single step up ("forward") or down ("backward") the stacking order by
 * swapping layers with its nearest neighbour. Returns the z_index changes to make (none
 * when it is already at the top or bottom).
 */
export function restack(
  objects: readonly Layered[],
  id: string,
  direction: "forward" | "backward",
): { id: string; z_index: number }[] {
  const sorted = [...objects].sort((a, b) => a.z_index - b.z_index || a.id.localeCompare(b.id));
  const index = sorted.findIndex((object) => object.id === id);
  if (index === -1) return [];
  const neighbour = sorted[direction === "forward" ? index + 1 : index - 1];
  if (!neighbour) return [];
  const current = sorted[index];
  if (neighbour.z_index === current.z_index) {
    // Same layer number: step past the neighbour instead of swapping equal values.
    return [{ id, z_index: current.z_index + (direction === "forward" ? 1 : -1) }];
  }
  return [
    { id, z_index: neighbour.z_index },
    { id: neighbour.id, z_index: current.z_index },
  ];
}
