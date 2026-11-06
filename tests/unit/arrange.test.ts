import { describe, expect, it } from "vitest";
import { alignObjects, restack } from "@/lib/board/arrange";

const a = { id: "a", x: 0, y: 0, width: 100, height: 50 };
const b = { id: "b", x: 200, y: 100, width: 50, height: 100 };

describe("alignObjects", () => {
  it("needs at least two objects", () => {
    expect(alignObjects([a], "left")).toEqual([]);
  });

  it("aligns edges and centres against the combined bounds", () => {
    expect(alignObjects([a, b], "left")).toEqual([{ id: "b", x: 0, y: 100 }]);
    expect(alignObjects([a, b], "right")).toEqual([{ id: "a", x: 150, y: 0 }]);
    expect(alignObjects([a, b], "top")).toEqual([{ id: "b", x: 200, y: 0 }]);
    expect(alignObjects([a, b], "bottom")).toEqual([{ id: "a", x: 0, y: 150 }]);
    expect(alignObjects([a, b], "center")).toEqual([
      { id: "a", x: 75, y: 0 },
      { id: "b", x: 100, y: 100 },
    ]);
    expect(alignObjects([a, b], "middle")).toEqual([
      { id: "a", x: 0, y: 75 },
      { id: "b", x: 200, y: 50 },
    ]);
  });

  it("measures arrows by their real box, whichever way they point", () => {
    const arrow = { id: "c", x: 300, y: 300, width: -100, height: -100 }; // spans 200..300
    expect(alignObjects([a, arrow], "left")).toEqual([{ id: "c", x: 100, y: 300 }]);
  });
});

describe("restack", () => {
  const layers = [
    { id: "low", z_index: 1 },
    { id: "mid", z_index: 5 },
    { id: "top", z_index: 9 },
  ];
  it("swaps with the neighbour above or below", () => {
    expect(restack(layers, "mid", "forward")).toEqual([
      { id: "mid", z_index: 9 },
      { id: "top", z_index: 5 },
    ]);
    expect(restack(layers, "mid", "backward")).toEqual([
      { id: "mid", z_index: 1 },
      { id: "low", z_index: 5 },
    ]);
  });
  it("does nothing at the ends or for unknown ids", () => {
    expect(restack(layers, "top", "forward")).toEqual([]);
    expect(restack(layers, "low", "backward")).toEqual([]);
    expect(restack(layers, "nope", "forward")).toEqual([]);
  });
  it("steps past a neighbour on the same layer", () => {
    expect(
      restack(
        [
          { id: "a", z_index: 2 },
          { id: "b", z_index: 2 },
        ],
        "a",
        "forward",
      ),
    ).toEqual([{ id: "a", z_index: 3 }]);
  });
});
