import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts so that a caller's
 * `className` reliably overrides a component's defaults (later wins).
 * The custom type-scale tokens are registered so `text-headline` is treated
 * as a font size, not a colour.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "headline", "title"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
