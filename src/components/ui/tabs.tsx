"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabDefinition {
  id: string;
  label: string;
  /** Small count shown after the label, e.g. pending requests. */
  count?: number;
}

interface TabsProps {
  tabs: TabDefinition[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  children: ReactNode;
  variant?: "underline" | "pills";
  className?: string;
  panelClassName?: string;
}

/**
 * Tabs following the WAI-ARIA pattern: arrow keys move between tabs, Home/End
 * jump, and only the selected tab is in the Tab order.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  children,
  variant = "underline",
  className,
  panelClassName,
}: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "flex gap-1 overflow-x-auto",
          variant === "underline" ? "border-b border-line" : "rounded-full bg-ink/5 p-1",
        )}
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              data-tab={tab.id}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-150",
                variant === "underline"
                  ? cn(
                      "-mb-px border-b-2 px-3 py-2.5",
                      selected ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                    )
                  : cn(
                      "flex-1 justify-center rounded-full px-3 py-1.5",
                      selected ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
                    ),
              )}
            >
              {tab.label}
              {tab.count ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] text-white">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${value}`}
        aria-labelledby={`${baseId}-tab-${value}`}
        tabIndex={0}
        className={cn("outline-none focus-visible:outline-2", panelClassName)}
      >
        {children}
      </div>
    </div>
  );
}
