import type { CanvasObject } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `x`,`y` is the world point at the top-left of the viewport; `zoom` is screen px per world unit. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

/** Zooms while keeping the world point under `anchor` (a screen point) fixed. */
export function zoomAt(camera: Camera, anchor: Point, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(camera, anchor);
  return { zoom, x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom };
}

/** Axis-aligned bounds with positive size, whatever the object type. */
export function objectBounds(object: Pick<CanvasObject, "x" | "y" | "width" | "height">): Bounds {
  const x = Math.min(object.x, object.x + object.width);
  const y = Math.min(object.y, object.y + object.height);
  return { x, y, width: Math.abs(object.width), height: Math.abs(object.height) };
}

export function unionBounds(items: Bounds[]): Bounds | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function contentBounds(
  objects: Pick<CanvasObject, "x" | "y" | "width" | "height">[],
  padding = 0,
): Bounds | null {
  const bounds = unionBounds(objects.map(objectBounds));
  if (!bounds) return null;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/** The camera that fits `bounds` inside a viewport, centred. */
export function fitCamera(bounds: Bounds, viewport: { width: number; height: number }, maxZoom = 1): Camera {
  const zoom = clampZoom(
    Math.min(maxZoom, viewport.width / Math.max(1, bounds.width), viewport.height / Math.max(1, bounds.height)),
  );
  return {
    zoom,
    x: bounds.x - (viewport.width / zoom - bounds.width) / 2,
    y: bounds.y - (viewport.height / zoom - bounds.height) / 2,
  };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** New bounds after dragging a corner handle by (dx, dy) in world units. */
export function resizeBounds(start: Bounds, handle: ResizeHandle, dx: number, dy: number, minSize = 24): Bounds {
  let { x, y, width, height } = start;
  if (handle === "nw" || handle === "sw") {
    const next = Math.max(minSize, width - dx);
    x += width - next;
    width = next;
  } else {
    width = Math.max(minSize, width + dx);
  }
  if (handle === "nw" || handle === "ne") {
    const next = Math.max(minSize, height - dy);
    y += height - next;
    height = next;
  } else {
    height = Math.max(minSize, height + dy);
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Drops points closer than `tolerance` to the previous kept point, and caps the total. */
export function simplifyStroke(points: Point[], tolerance = 2, maxPoints = 1500): Point[] {
  if (points.length <= 2) return points;
  const kept: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const last = kept[kept.length - 1];
    const point = points[index];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= tolerance) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  if (kept.length <= maxPoints) return kept;
  const step = kept.length / maxPoints;
  const sampled: Point[] = [];
  for (let index = 0; index < maxPoints - 1; index += 1) sampled.push(kept[Math.floor(index * step)]);
  sampled.push(kept[kept.length - 1]);
  return sampled;
}

/** Converts a freehand stroke in world space to an origin, a size and relative flat points. */
export function strokeToObject(points: Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
} {
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: round(minX),
    y: round(minY),
    width: Math.max(1, round(maxX - minX)),
    height: Math.max(1, round(maxY - minY)),
    points: points.flatMap((p) => [round(p.x - minX), round(p.y - minY)]),
  };
}

/** The three points of an arrowhead at the end of a segment. */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    to,
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

export function pointsToPath(points: number[]): string {
  if (points.length < 2) return "";
  let path = `M${points[0]} ${points[1]}`;
  for (let index = 2; index + 1 < points.length; index += 2) {
    path += `L${points[index]} ${points[index + 1]}`;
  }
  // A single tap still draws a dot.
  if (points.length === 2) path += `L${points[0] + 0.01} ${points[1]}`;
  return path;
}
