import type { CanvasObject, CanvasObjectType, CanvasProps } from "@/lib/board/types";

let counter = 0;

/** A board object with sensible defaults. Ids are readable ("n1", "n2") so assertions stay short. */
export function makeObject(
  overrides: Partial<Omit<CanvasObject, "props">> & { props?: CanvasProps; text?: string } = {},
): CanvasObject {
  counter += 1;
  const { props, text, ...rest } = overrides;
  const type: CanvasObjectType = rest.type ?? "STICKY_NOTE";
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    type,
    x: 0,
    y: 0,
    width: 180,
    height: 140,
    rotation: 0,
    z_index: counter,
    props: { ...(text !== undefined ? { text } : {}), ...props },
    version: 1,
    deleted: false,
    created_by: null,
    updated_by: null,
    updated_at: "2026-11-02T10:00:00.000Z",
    ...rest,
  };
}

/** A sticky note at (x, y). Notes are 180×140, so a 300px column spacing keeps them apart. */
export function note(text: string, x = 0, y = 0, extra: Partial<CanvasObject> = {}): CanvasObject {
  return makeObject({ type: "STICKY_NOTE", text, x, y, ...extra });
}

/** An arrow from (x1, y1) to (x2, y2). */
export function arrow(x1: number, y1: number, x2: number, y2: number): CanvasObject {
  return makeObject({ type: "ARROW", x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

export function resetFixtureIds(): void {
  counter = 0;
}
