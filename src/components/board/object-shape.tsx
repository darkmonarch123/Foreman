import { FONT_STACK, LINE_HEIGHT, TEXT_PADDING } from "@/lib/board/defaults";
import { arrowHead, pointsToPath } from "@/lib/board/geometry";
import type { CanvasObject } from "@/lib/board/types";

type ShapeObject = Pick<CanvasObject, "type" | "x" | "y" | "width" | "height" | "props">;

interface TextBlockProps {
  object: ShapeObject;
  centered: boolean;
  padding?: number;
  clip?: boolean;
}

/**
 * Text is rendered as HTML inside the SVG so it wraps like normal text. It is
 * always inserted as a text node: user content is never interpreted as markup.
 */
function TextBlock({ object, centered, padding = TEXT_PADDING, clip = true }: TextBlockProps) {
  const { x, y, width, height, props } = object;
  if (!props.text) return null;
  const fontSize = props.fontSize ?? 15;
  const align = props.textAlign ?? (centered ? "center" : "left");
  return (
    <foreignObject
      x={x}
      y={y}
      width={Math.max(1, width)}
      height={clip ? Math.max(1, height) : 10_000}
      pointerEvents="none"
    >
      <div
        style={{
          boxSizing: "border-box",
          width: "100%",
          height: clip ? "100%" : undefined,
          padding,
          display: "flex",
          flexDirection: "column",
          justifyContent: centered ? "center" : "flex-start",
          overflow: clip ? "hidden" : undefined,
          fontFamily: FONT_STACK,
          fontSize,
          fontWeight: props.bold ? 600 : 400,
          lineHeight: LINE_HEIGHT,
          color: props.color ?? "#121212",
          textAlign: align,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          userSelect: "none",
        }}
      >
        <span>{props.text}</span>
      </div>
    </foreignObject>
  );
}

interface ObjectShapeProps {
  object: ShapeObject;
  /** Thumbnails skip text and shadows. */
  simplified?: boolean;
  /** While the object's text is being edited in place, the static text is hidden. */
  hideText?: boolean;
}

/** Draws one canvas object. Pure and stateless: used by the editor, previews and thumbnails alike. */
export function ObjectShape({ object, simplified = false, hideText = false }: ObjectShapeProps) {
  const { x, y, width, height, props } = object;
  const showText = !simplified && !hideText;

  switch (object.type) {
    case "STICKY_NOTE":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={6}
            fill={props.fill ?? "#F8DD72"}
            style={simplified ? undefined : { filter: "drop-shadow(0 4px 6px rgb(18 18 18 / 0.14))" }}
          />
          {showText ? <TextBlock object={object} centered={false} /> : null}
        </g>
      );
    case "TEXT":
      return (
        <g>
          {/* Transparent hit area so empty space inside the text box is selectable. */}
          <rect x={x} y={y} width={width} height={height} fill="transparent" />
          {showText ? (
            <TextBlock object={object} centered={false} padding={0} clip={false} />
          ) : simplified && props.text ? (
            <rect
              x={x}
              y={y + height * 0.25}
              width={Math.min(width, (props.text.length * (props.fontSize ?? 15)) / 2)}
              height={Math.max(3, (props.fontSize ?? 15) * 0.45)}
              rx={2}
              fill="#12121233"
            />
          ) : null}
        </g>
      );
    case "RECTANGLE":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={10}
            fill={props.fill ?? "#FFFFFF"}
            stroke={props.stroke ?? "#121212"}
            strokeWidth={props.strokeWidth ?? 2}
          />
          {showText ? <TextBlock object={object} centered /> : null}
        </g>
      );
    case "CIRCLE":
      return (
        <g>
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={Math.abs(width / 2)}
            ry={Math.abs(height / 2)}
            fill={props.fill ?? "#FFFFFF"}
            stroke={props.stroke ?? "#121212"}
            strokeWidth={props.strokeWidth ?? 2}
          />
          {showText ? <TextBlock object={object} centered /> : null}
        </g>
      );
    case "ARROW": {
      const from = { x, y };
      const to = { x: x + width, y: y + height };
      const strokeWidth = props.strokeWidth ?? 2;
      const stroke = props.stroke ?? "#121212";
      const [tip, left, right] = arrowHead(from, to, 8 + strokeWidth * 2);
      return (
        <g>
          {/* Wide invisible stroke: a comfortable target for a thin line. */}
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth + 12)}
          />
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={stroke} />
        </g>
      );
    }
    case "DRAWING": {
      const path = pointsToPath(props.points ?? []);
      if (!path) return null;
      const strokeWidth = props.strokeWidth ?? 3;
      return (
        <g transform={`translate(${x} ${y})`}>
          <path
            d={path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth + 12)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={path}
            fill="none"
            stroke={props.stroke ?? "#121212"}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }
  }
}
