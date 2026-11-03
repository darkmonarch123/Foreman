/**
 * Where each story note sits in the three steps: [x%, y%, rotation, scale, opacity, done].
 * Shared by the server (first layout, before any script runs) and the scroll script.
 */
export const STORY_LAYOUTS: number[][][] = [
  [
    [6, 10, -8, 1, 1, 0],
    [56, 6, 7, 1, 1, 0],
    [30, 36, -3, 1, 1, 0],
    [62, 42, 9, 1, 1, 0],
    [8, 66, 5, 1, 1, 0],
    [48, 72, -6, 1, 1, 0],
  ],
  [
    [3, 14, 0, 1, 1, 0],
    [3, 34, 0, 1, 1, 0],
    [35, 14, 0, 1, 1, 0],
    [67, 14, 0, 1, 1, 0],
    [67, 34, 0, 1, 1, 0],
    [67, 54, 0, 1, 1, 0],
  ],
  [
    [3, 14, 0, 0.8, 0.35, 0],
    [3, 30, 0, 0.8, 0.35, 0],
    [3, 46, 0, 0.8, 0.35, 0],
    [52, 20, 0, 1.25, 1, 1],
    [52, 44, 0, 1.25, 1, 1],
    [52, 68, 0, 1.25, 1, 1],
  ],
];
export const LABEL_OPACITY = [
  [0, 0, 0],
  [1, 1, 1],
  [0, 0, 1],
];

export function applyNoteStyle(note: HTMLElement, values: number[]): void {
  note.style.setProperty("--x", String(values[0]));
  note.style.setProperty("--y", String(values[1]));
  note.style.setProperty("--r", `${values[2]}deg`);
  note.style.setProperty("--s", String(values[3]));
  note.style.opacity = String(values[4]);
  note.style.setProperty("--done", String(values[5]));
}
