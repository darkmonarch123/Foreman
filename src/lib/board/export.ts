import { FONT_STACK, LINE_HEIGHT, TEXT_PADDING } from "./defaults";
import { arrowHead, contentBounds, type Bounds } from "./geometry";
import type { CanvasObject } from "./types";

/**
 * PNG export.
 *
 * The board is redrawn onto an off-screen canvas from the object data, so the
 * image contains the canvas content and nothing else: no panels, no member
 * list or emails, no comments, no remote cursors, no selection handles.
 * Everything happens in the browser; no server or secret is involved.
 */

export const EXPORT_BACKGROUND = "#FCFAF6";
/** Browsers refuse very large canvases; stay well inside common limits. */
export const MAX_EXPORT_PIXELS = 16_000_000;
export const MAX_EXPORT_SIDE = 8192;

type Measure = (text: string) => number;

/** Greedy word wrap. Honours explicit newlines and breaks words that are wider than the line. */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      // A single word wider than the box: break it by characters.
      let chunk = "";
      for (const char of word) {
        if (chunk && measure(chunk + char) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

export interface ExportPlan {
  bounds: Bounds;
  scale: number;
  width: number;
  height: number;
}

/**
 * Chooses the output size: the requested scale if it fits, otherwise the
 * largest scale that keeps the image inside browser canvas limits.
 */
export function planExport(bounds: Bounds, requestedScale = 2): ExportPlan {
  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);
  const scale = Math.min(
    requestedScale,
    MAX_EXPORT_SIDE / safeWidth,
    MAX_EXPORT_SIDE / safeHeight,
    Math.sqrt(MAX_EXPORT_PIXELS / (safeWidth * safeHeight)),
  );
  return {
    bounds,
    scale,
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

/** Bounds for a full-board export, or null when the board is empty. */
export function fullBoardBounds(objects: CanvasObject[], padding = 48): Bounds | null {
  return contentBounds(objects, padding);
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "scale"
  | "translate"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
  | "ellipse"
  | "roundRect"
  | "fillText"
  | "measureText"
  | "rect"
  | "clip"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
};

function drawText(ctx: Ctx, object: CanvasObject, box: Bounds, verticalCenter: boolean, padding = TEXT_PADDING): void {
  const text = object.props.text;
  if (!text) return;
  const fontSize = object.props.fontSize ?? 15;
  const align = object.props.textAlign ?? (verticalCenter ? "center" : "left");
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.font = `${object.props.bold ? 600 : 400} ${fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = object.props.color ?? "#121212";
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const innerWidth = Math.max(1, box.width - padding * 2);
  const lines = wrapText(text, innerWidth, (value) => ctx.measureText(value).width);
  const lineHeight = fontSize * LINE_HEIGHT;
  const blockHeight = lines.length * lineHeight;
  const startY = verticalCenter ? box.y + Math.max(padding, (box.height - blockHeight) / 2) : box.y + padding;
  const anchorX =
    align === "center" ? box.x + box.width / 2 : align === "right" ? box.x + box.width - padding : box.x + padding;
  lines.forEach((line, index) => {
    // Half-leading keeps the baseline grid aligned with the on-screen rendering.
    ctx.fillText(line, anchorX, startY + index * lineHeight + (lineHeight - fontSize) / 2);
  });
  ctx.restore();
}

export function drawObject(ctx: Ctx, object: CanvasObject): void {
  const { x, y, width, height, props } = object;
  ctx.save();
  switch (object.type) {
    case "STICKY_NOTE": {
      ctx.save();
      ctx.shadowColor = "rgba(18,18,18,0.18)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = props.fill ?? "#F8DD72";
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 6);
      ctx.fill();
      ctx.restore();
      drawText(ctx, object, { x, y, width, height }, false);
      break;
    }
    case "TEXT": {
      drawText(ctx, object, { x, y, width, height: Math.max(height, 10_000) }, false, 0);
      break;
    }
    case "RECTANGLE": {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 10);
      if (props.fill && props.fill !== "transparent") {
        ctx.fillStyle = props.fill;
        ctx.fill();
      }
      if ((props.strokeWidth ?? 2) > 0 && props.stroke !== "transparent") {
        ctx.strokeStyle = props.stroke ?? "#121212";
        ctx.lineWidth = props.strokeWidth ?? 2;
        ctx.stroke();
      }
      drawText(ctx, object, { x, y, width, height }, true);
      break;
    }
    case "CIRCLE": {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
      if (props.fill && props.fill !== "transparent") {
        ctx.fillStyle = props.fill;
        ctx.fill();
      }
      if ((props.strokeWidth ?? 2) > 0 && props.stroke !== "transparent") {
        ctx.strokeStyle = props.stroke ?? "#121212";
        ctx.lineWidth = props.strokeWidth ?? 2;
        ctx.stroke();
      }
      drawText(ctx, object, { x, y, width, height }, true);
      break;
    }
    case "ARROW": {
      const from = { x, y };
      const to = { x: x + width, y: y + height };
      const strokeWidth = props.strokeWidth ?? 2;
      ctx.strokeStyle = props.stroke ?? "#121212";
      ctx.fillStyle = props.stroke ?? "#121212";
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const [tip, left, right] = arrowHead(from, to, 8 + strokeWidth * 2);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "DRAWING": {
      const points = props.points ?? [];
      if (points.length < 2) break;
      ctx.strokeStyle = props.stroke ?? "#121212";
      ctx.lineWidth = props.strokeWidth ?? 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x + points[0], y + points[1]);
      for (let index = 2; index + 1 < points.length; index += 2) {
        ctx.lineTo(x + points[index], y + points[index + 1]);
      }
      if (points.length === 2) ctx.lineTo(x + points[0] + 0.01, y + points[1]);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Draws the objects that intersect the plan's bounds, in paint order. */
export function drawBoard(ctx: Ctx, objects: CanvasObject[], plan: ExportPlan): void {
  ctx.save();
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.scale(plan.scale, plan.scale);
  ctx.translate(-plan.bounds.x, -plan.bounds.y);
  for (const object of objects) {
    if (object.deleted) continue;
    drawObject(ctx, object);
  }
  ctx.restore();
}

export function exportFileName(title: string, now: Date = new Date()): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "board";
  return `${slug}-${now.toISOString().slice(0, 10)}.png`;
}

/** Renders the board to a PNG blob. Throws if the browser cannot produce one. */
export async function renderBoardPng(objects: CanvasObject[], bounds: Bounds, requestedScale = 2): Promise<Blob> {
  const plan = planExport(bounds, requestedScale);
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  // Make sure the UI font is loaded so text is measured and drawn with it.
  if (document.fonts?.load) {
    await Promise.allSettled([
      document.fonts.load(`400 15px ${FONT_STACK}`),
      document.fonts.load(`600 15px ${FONT_STACK}`),
    ]);
  }
  drawBoard(ctx, objects, plan);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || blob.size === 0) throw new Error("The image could not be created.");
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
