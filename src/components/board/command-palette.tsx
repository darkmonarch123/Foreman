"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/** Ctrl/Cmd+K: a filterable list of everything you can do on the board (combobox + listbox pattern). */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<Palette onClose={onClose} commands={commands} />, document.body);
}

function Palette({ onClose, commands }: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const available = useMemo(() => commands.filter((command) => !command.disabled), [commands]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return available;
    return available.filter((command) => command.label.toLowerCase().includes(needle));
  }, [available, query]);
  const index = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  function choose(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]">
      <div aria-hidden className="absolute inset-0 bg-ink/30" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg animate-pop-in overflow-hidden rounded-card bg-surface shadow-lift"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[index] ? `${listId}-${results[index].id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index + 1) % Math.max(1, results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index - 1 + results.length) % Math.max(1, results.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(results[index]);
              } else if (event.key === "Escape" || event.key === "Tab") {
                event.preventDefault();
                onClose();
              }
            }}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted" role="presentation">
              No matching commands
            </li>
          ) : (
            results.map((command, position) => (
              <li
                key={command.id}
                id={`${listId}-${command.id}`}
                role="option"
                aria-selected={position === index}
                onMouseEnter={() => setActive(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(command)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  position === index ? "bg-ink text-white" : "text-ink",
                )}
              >
                {command.icon ? <span className="shrink-0 [&_svg]:size-4">{command.icon}</span> : null}
                <span className="flex-1 truncate">{command.label}</span>
                {command.hint ? (
                  <kbd className={cn("font-sans text-xs", position === index ? "text-white/70" : "text-muted")}>
                    {command.hint}
                  </kbd>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
