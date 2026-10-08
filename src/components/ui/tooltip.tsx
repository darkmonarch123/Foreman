"use client";

import { cloneElement, useId, useState, type ReactElement } from "react";
import { cn } from "@/lib/cn";

interface TooltipProps {
  label: string;
  /** Keyboard shortcut shown after the label. */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement<{ "aria-describedby"?: string }>;
}

const sides = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/** Shows on hover and on keyboard focus; hidden with Escape. Supplements, never replaces, an accessible name. */
export function Tooltip({ label, shortcut, side = "top", children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {cloneElement(children, { "aria-describedby": open ? id : undefined })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-40 flex items-center gap-2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-soft transition-opacity duration-100",
          sides[side],
          open ? "opacity-100" : "opacity-0",
        )}
        hidden={!open}
      >
        {label}
        {shortcut ? <kbd className="rounded bg-white/15 px-1 font-sans text-[11px]">{shortcut}</kbd> : null}
      </span>
    </span>
  );
}
