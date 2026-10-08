import type { PreviewObject } from "@/components/board/board-preview";

/**
 * Small illustrative boards for the landing page, drawn by the product's own
 * renderer. They contain generic sample content only: no people, names,
 * comments or activity.
 */

const INK = "#121212";
const note = (text: string, x: number, y: number, fill: string, width = 170, height = 110): PreviewObject => ({
  type: "STICKY_NOTE",
  x,
  y,
  width,
  height,
  props: { text, fill, fontSize: 15, color: INK },
});
const text = (value: string, x: number, y: number, fontSize = 20, width = 260, bold = true): PreviewObject => ({
  type: "TEXT",
  x,
  y,
  width,
  height: fontSize * 1.6,
  props: { text: value, fontSize, bold, color: INK },
});
const box = (x: number, y: number, width: number, height: number, fill: string, label = ""): PreviewObject => ({
  type: "RECTANGLE",
  x,
  y,
  width,
  height,
  props: { fill, stroke: "#E9E5DF", strokeWidth: 1, text: label, fontSize: 15, bold: true, color: INK },
});
const arrow = (x: number, y: number, dx: number, dy: number): PreviewObject => ({
  type: "ARROW",
  x,
  y,
  width: dx,
  height: dy,
  props: { stroke: INK, strokeWidth: 2 },
});
const circle = (label: string, x: number, y: number, size: number, fill: string): PreviewObject => ({
  type: "CIRCLE",
  x,
  y,
  width: size,
  height: size,
  props: { fill, stroke: "#E9E5DF", strokeWidth: 1, text: label, fontSize: 15, bold: true, color: INK },
});
const scribble = (x: number, y: number, points: number[], stroke = INK): PreviewObject => ({
  type: "DRAWING",
  x,
  y,
  width: 100,
  height: 40,
  props: { stroke, strokeWidth: 3, points },
});

export const thoughtToForm: PreviewObject[] = [
  note("A rough idea", 0, 30, "#F8DD72"),
  note("Another angle", 30, 170, "#F3A5A0"),
  arrow(190, 100, 90, 30),
  arrow(210, 215, 70, -40),
  box(300, 60, 240, 190, "#FFFFFF"),
  text("The plan", 324, 80, 20, 200),
  note("First step", 324, 124, "#A8DDB2", 192, 46),
  note("Second step", 324, 182, "#A8D8F0", 192, 46),
];

export const planning: PreviewObject[] = [
  box(0, 0, 170, 250, "#E6F3FA"),
  text("Plan", 18, 16, 18, 130),
  note("Scope", 18, 56, "#A8D8F0", 134, 56),
  note("Timeline", 18, 124, "#A8D8F0", 134, 56),
  box(190, 0, 170, 250, "#E9ECFC"),
  text("Build", 208, 16, 18, 130),
  note("In progress", 208, 56, "#AEB9F4", 134, 56),
  box(380, 0, 170, 250, "#E6F5E9"),
  text("Test", 398, 16, 18, 130),
  note("Review", 398, 56, "#A8DDB2", 134, 56),
];

export const structure: PreviewObject[] = [
  circle("Topic", 200, 80, 130, "#F8DD72"),
  box(0, 0, 150, 70, "#E6F3FA", "Notes"),
  box(0, 220, 150, 70, "#FBE6E4", "Risks"),
  box(390, 0, 150, 70, "#E6F5E9", "Tasks"),
  box(390, 220, 150, 70, "#E9ECFC", "Links"),
  arrow(200, 115, -46, -50),
  arrow(205, 185, -52, 50),
  arrow(330, 115, 56, -50),
  arrow(326, 185, 60, 50),
];

export const yours: PreviewObject[] = [
  note("Any colour", 0, 0, "#F3A5A0", 150, 100),
  note("Any size", 170, 20, "#AEB9F4", 200, 140),
  note("Any shape", 20, 120, "#A8DDB2", 130, 80),
  circle("Round", 390, 0, 110, "#A8D8F0"),
  text("Your words", 390, 130, 26, 200),
  scribble(170, 190, [0, 20, 20, 4, 40, 26, 60, 6, 80, 24, 100, 8, 120, 22, 150, 10], "#C0392B"),
  box(390, 180, 150, 60, "#FDF5D4", "Label"),
];

export const together: PreviewObject[] = [
  box(0, 0, 540, 250, "#FFFFFF"),
  note("Draft agenda", 30, 34, "#F8DD72", 150, 90),
  note("Open questions", 200, 34, "#A8D8F0", 150, 90),
  note("Decisions", 370, 34, "#A8DDB2", 140, 90),
  arrow(184, 80, 12, 0),
  arrow(354, 80, 12, 0),
  box(30, 150, 480, 70, "#FCFAF6", ""),
  text("Everyone edits the same board at the same time", 48, 172, 15, 440, false),
];

export const categoryVignettes: Record<string, PreviewObject[]> = {
  Boards: [
    box(0, 0, 90, 120, "#FFFFFF"),
    box(100, 0, 90, 120, "#FFFFFF"),
    note("", 12, 14, "#A8D8F0", 66, 30),
    note("", 12, 52, "#A8D8F0", 66, 30),
    note("", 112, 14, "#F8DD72", 66, 30),
  ],
  Tasks: [
    note("", 0, 0, "#FFFFFF", 190, 34),
    note("", 0, 44, "#FFFFFF", 190, 34),
    note("", 0, 88, "#FFFFFF", 190, 34),
    circle("", 10, 9, 16, "#A8DDB2"),
    circle("", 10, 53, 16, "#A8DDB2"),
    circle("", 10, 97, 16, "#FFFFFF"),
  ],
  Whiteboards: [
    circle("", 0, 20, 70, "#FFFFFF"),
    box(120, 30, 70, 50, "#FFFFFF"),
    arrow(74, 55, 40, 0),
    scribble(20, 100, [0, 10, 20, 0, 40, 14, 60, 2, 80, 12, 110, 4, 150, 10]),
  ],
  Notes: [note("", 0, 10, "#F8DD72", 90, 90), note("", 60, 30, "#F3A5A0", 90, 90), note("", 110, 0, "#AEB9F4", 80, 80)],
  Collaboration: [
    circle("", 30, 20, 60, "#F3A5A0"),
    circle("", 100, 20, 60, "#AEB9F4"),
    circle("", 65, 60, 60, "#A8DDB2"),
  ],
};
