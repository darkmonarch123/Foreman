import { contentBounds } from "@/lib/board/geometry";
import type { CanvasObjectType, CanvasProps } from "@/lib/board/types";
import { cn } from "@/lib/cn";
import { ObjectShape } from "./object-shape";

export interface PreviewObject {
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  props: CanvasProps;
}

interface BoardPreviewProps {
  objects: PreviewObject[];
  /** Describes the picture for people who cannot see it. Omit for purely decorative use. */
  label?: string;
  /** Thumbnails drop text and shadows. */
  simplified?: boolean;
  padding?: number;
  className?: string;
}

/**
 * A static, scaled-to-fit drawing of board content, made with the same
 * renderer as the editor. Used for template previews, dashboard thumbnails
 * and the product illustrations on the landing page.
 */
export function BoardPreview({ objects, label, simplified = false, padding = 40, className }: BoardPreviewProps) {
  const bounds = contentBounds(objects, padding) ?? { x: 0, y: 0, width: 400, height: 240 };
  return (
    <svg
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("block size-full", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {objects.map((object, index) => (
        <ObjectShape key={index} object={object} simplified={simplified} />
      ))}
    </svg>
  );
}
