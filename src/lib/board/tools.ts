import type { CanvasObjectType } from "./types";

export type Tool =
  "select" | "hand" | "pen" | "eraser" | "sticky" | "text" | "rectangle" | "circle" | "arrow" | "comment";

export interface ToolDefinition {
  id: Tool;
  label: string;
  shortcut: string;
  /** Tools that change the board are unavailable to viewers. */
  requiresEdit: boolean;
}

export const TOOLS: ToolDefinition[] = [
  { id: "select", label: "Select", shortcut: "V", requiresEdit: false },
  { id: "hand", label: "Hand (pan)", shortcut: "H", requiresEdit: false },
  { id: "pen", label: "Pen", shortcut: "P", requiresEdit: true },
  { id: "eraser", label: "Eraser", shortcut: "E", requiresEdit: true },
  { id: "sticky", label: "Sticky note", shortcut: "N", requiresEdit: true },
  { id: "text", label: "Text", shortcut: "T", requiresEdit: true },
  { id: "rectangle", label: "Rectangle", shortcut: "R", requiresEdit: true },
  { id: "circle", label: "Circle", shortcut: "O", requiresEdit: true },
  { id: "arrow", label: "Arrow", shortcut: "A", requiresEdit: true },
  { id: "comment", label: "Comment", shortcut: "C", requiresEdit: false },
];

export const TOOL_OBJECT_TYPE: Partial<Record<Tool, CanvasObjectType>> = {
  sticky: "STICKY_NOTE",
  text: "TEXT",
  rectangle: "RECTANGLE",
  circle: "CIRCLE",
  arrow: "ARROW",
};

export function toolForKey(key: string): Tool | null {
  const upper = key.toUpperCase();
  return TOOLS.find((tool) => tool.shortcut === upper)?.id ?? null;
}

export interface ShortcutEntry {
  keys: string[];
  action: string;
}

/** Shown in the shortcut help dialog. Kept next to the tool list so the two cannot drift. */
export function shortcutList(isMac: boolean): { group: string; entries: ShortcutEntry[] }[] {
  const mod = isMac ? "⌘" : "Ctrl";
  return [
    { group: "Tools", entries: TOOLS.map((tool) => ({ keys: [tool.shortcut], action: tool.label })) },
    {
      group: "Editing",
      entries: [
        { keys: ["Delete", "Backspace"], action: "Delete the selected item" },
        { keys: [`${mod} Z`], action: "Undo your last change" },
        { keys: [`${mod} Shift Z`], action: "Redo" },
        { keys: [`${mod} D`], action: "Duplicate the selected item" },
        { keys: ["Enter"], action: "Edit the selected item's text" },
        { keys: ["Arrow keys"], action: "Nudge the selected item (hold Shift for larger steps)" },
        { keys: ["Esc"], action: "Stop editing, deselect, or return to Select" },
      ],
    },
    {
      group: "View",
      entries: [
        { keys: ["Space + drag"], action: "Pan the canvas" },
        { keys: [`${mod} scroll`], action: "Zoom" },
        { keys: [`${mod} +`, `${mod} −`], action: "Zoom in and out" },
        { keys: [`${mod} 0`], action: "Zoom to fit the board" },
        { keys: [`${mod} K`], action: "Open the command palette" },
        { keys: ["?"], action: "Show this list" },
      ],
    },
  ];
}

/** True when a key event should be left alone because the person is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
