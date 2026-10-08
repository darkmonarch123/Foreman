import type { CanvasObject, CanvasObjectType, CreatePayload } from "./types";

/** Palette offered in the object toolbar. All values are design tokens. */
export const FILL_COLORS = [
  { value: "#F8DD72", label: "Yellow" },
  { value: "#A8D8F0", label: "Sky" },
  { value: "#AEB9F4", label: "Lavender" },
  { value: "#A8DDB2", label: "Mint" },
  { value: "#F3A5A0", label: "Coral" },
  { value: "#FFFFFF", label: "White" },
] as const;

export const STROKE_COLORS = [
  { value: "#121212", label: "Ink" },
  { value: "#666666", label: "Grey" },
  { value: "#2563EB", label: "Blue" },
  { value: "#268A57", label: "Green" },
  { value: "#C0392B", label: "Red" },
] as const;

export const FONT_SIZES = [13, 15, 20, 28, 40] as const;

export const TEXT_PADDING = 12;
export const LINE_HEIGHT = 1.35;
export const FONT_STACK = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';

export const TYPE_LABELS: Record<CanvasObjectType, string> = {
  STICKY_NOTE: "Sticky note",
  TEXT: "Text",
  RECTANGLE: "Rectangle",
  CIRCLE: "Circle",
  ARROW: "Arrow",
  DRAWING: "Drawing",
};

const DEFAULT_SIZE: Record<CanvasObjectType, { width: number; height: number }> = {
  STICKY_NOTE: { width: 180, height: 140 },
  TEXT: { width: 260, height: 44 },
  RECTANGLE: { width: 220, height: 140 },
  CIRCLE: { width: 150, height: 150 },
  ARROW: { width: 180, height: 0 },
  DRAWING: { width: 1, height: 1 },
};

/** The payload for a new object of `type`, centred on (or starting at) a world point. */
export function defaultPayload(type: CanvasObjectType, at: { x: number; y: number }): CreatePayload {
  const size = DEFAULT_SIZE[type];
  const origin = type === "ARROW" ? { x: at.x, y: at.y } : { x: at.x - size.width / 2, y: at.y - size.height / 2 };
  const base = { type, x: Math.round(origin.x), y: Math.round(origin.y), width: size.width, height: size.height };
  switch (type) {
    case "STICKY_NOTE":
      return { ...base, props: { text: "", fill: "#F8DD72", color: "#121212", fontSize: 15 } };
    case "TEXT":
      return { ...base, props: { text: "", color: "#121212", fontSize: 20 } };
    case "RECTANGLE":
    case "CIRCLE":
      return {
        ...base,
        props: { text: "", fill: "#FFFFFF", stroke: "#121212", strokeWidth: 2, color: "#121212", fontSize: 15 },
      };
    case "ARROW":
      return { ...base, props: { stroke: "#121212", strokeWidth: 2 } };
    case "DRAWING":
      return { ...base, props: { stroke: "#121212", strokeWidth: 3, points: [] } };
  }
}

export function supportsText(type: CanvasObjectType): boolean {
  return type === "STICKY_NOTE" || type === "TEXT" || type === "RECTANGLE" || type === "CIRCLE";
}

export function supportsFill(type: CanvasObjectType): boolean {
  return type === "STICKY_NOTE" || type === "RECTANGLE" || type === "CIRCLE";
}

export function supportsStroke(type: CanvasObjectType): boolean {
  return type === "RECTANGLE" || type === "CIRCLE" || type === "ARROW" || type === "DRAWING";
}

export function supportsResize(type: CanvasObjectType): boolean {
  return type !== "DRAWING";
}

/** A short, meaningful name for an object: its text if it has any, otherwise its type. */
export function describeObject(object: Pick<CanvasObject, "type" | "props">): string {
  const label = TYPE_LABELS[object.type];
  const text = object.props.text?.replace(/\s+/g, " ").trim();
  if (!text) return supportsText(object.type) ? `${label} (empty)` : label;
  return `${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
}
