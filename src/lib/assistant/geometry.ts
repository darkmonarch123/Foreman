import type { CanvasObject } from "@/lib/board/types";

/** Axis-aligned box in board coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Two objects closer than this (edge to edge) count as "nearby". */
export const NEAR_GAP = 160;
/** Overlaps of this many pixels or fewer on either axis are ignored. */
export const OVERLAP_TOLERANCE = 8;
/** How far from an object an arrow end may land and still count as attached. */
export const ARROW_ATTACH_TOLERANCE = 24;
const PLACEMENT_GAP = 24;

export function boxOf(object: Pick<CanvasObject, "x" | "y" | "width" | "height">): Box {
  return { x: object.x, y: object.y, width: Math.max(0, object.width), height: Math.max(0, object.height) };
}

/** Width and height of the intersection; 0 when the boxes do not overlap. */
export function overlapSize(a: Box, b: Box): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** Edge-to-edge distance along the larger axis gap; 0 when the boxes touch or overlap. */
export function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.max(dx, dy);
}

export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function pointInBox(box: Box, x: number, y: number, tolerance = 0): boolean {
  return (
    x >= box.x - tolerance &&
    x <= box.x + box.width + tolerance &&
    y >= box.y - tolerance &&
    y <= box.y + box.height + tolerance
  );
}

/** Start and end points of an arrow object (width and height are the delta and may be negative). */
export function arrowEnds(
  arrow: Pick<CanvasObject, "x" | "y" | "width" | "height">,
): [[number, number], [number, number]] {
  return [
    [arrow.x, arrow.y],
    [arrow.x + arrow.width, arrow.y + arrow.height],
  ];
}

function collides(candidate: Box, occupied: readonly Box[]): boolean {
  return occupied.some((box) => {
    const overlap = overlapSize(candidate, box);
    return overlap.width > 0 && overlap.height > 0;
  });
}

/**
 * Finds a deterministic free spot for a new object of `size` next to `anchor`:
 * right first, then below, left and above, moving outward one slot at a time.
 * `occupied` is every existing object plus the spots already given out in this run.
 */
export function findFreeSpot(
  anchor: Box,
  size: { width: number; height: number },
  occupied: readonly Box[],
): { x: number; y: number } {
  const stepX = size.width + PLACEMENT_GAP;
  const stepY = size.height + PLACEMENT_GAP;
  for (let ring = 0; ring < 40; ring += 1) {
    const candidates = [
      { x: anchor.x + anchor.width + PLACEMENT_GAP + ring * stepX, y: anchor.y },
      { x: anchor.x, y: anchor.y + anchor.height + PLACEMENT_GAP + ring * stepY },
      { x: anchor.x - size.width - PLACEMENT_GAP - ring * stepX, y: anchor.y },
      { x: anchor.x, y: anchor.y - size.height - PLACEMENT_GAP - ring * stepY },
    ];
    for (const candidate of candidates) {
      const box = { x: Math.round(candidate.x), y: Math.round(candidate.y), ...size };
      if (!collides(box, occupied)) return { x: box.x, y: box.y };
    }
  }
  const rightmost = occupied.reduce((max, box) => Math.max(max, box.x + box.width), anchor.x + anchor.width);
  return { x: Math.round(rightmost + PLACEMENT_GAP), y: Math.round(anchor.y) };
}
