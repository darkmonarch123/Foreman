"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a separator above this item. */
  separated?: boolean;
  shortcut?: string;
}

/**
 * Before its position is measured the menu is transparent rather than hidden,
 * so that its first item can already receive focus.
 */
const UNPOSITIONED: React.CSSProperties = { position: "fixed", left: 0, top: 0, opacity: 0 };

interface MenuListProps {
  items: MenuItem[];
  label: string;
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  listRef?: React.RefObject<HTMLDivElement | null>;
}

/** The menu surface: roving focus with arrow keys, Home/End, type-ahead, Escape to close. */
function MenuList({ items, label, onClose, style, className, id, listRef }: MenuListProps) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = listRef ?? localRef;

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [ref]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const match = nodes.find((node) => node.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      match?.focus();
    }
  }

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        "z-50 min-w-48 animate-pop-in rounded-control border border-line bg-surface p-1.5 shadow-lift outline-none",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.id} role="none">
          {item.separated ? <div role="separator" className="my-1.5 h-px bg-line" /> : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none",
              "focus:bg-ink/6 hover:bg-ink/6 aria-disabled:opacity-40",
              item.danger ? "text-error" : "text-ink",
            )}
          >
            {item.icon ? <span className="shrink-0 text-current [&_svg]:size-4">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut ? <kbd className="text-xs text-muted">{item.shortcut}</kbd> : null}
          </button>
        </div>
      ))}
    </div>
  );
}

function useDismiss(open: boolean, refs: React.RefObject<HTMLElement | null>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onClose);
    };
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

interface DropdownMenuProps {
  /** A single button element; aria and click wiring is added to it. */
  trigger: ReactElement<{
    onClick?: (event: React.MouseEvent) => void;
    "aria-haspopup"?: "menu";
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
    ref?: React.Ref<HTMLElement>;
  }>;
  items: MenuItem[];
  label: string;
  align?: "start" | "end";
  side?: "bottom" | "top";
}

export function DropdownMenu({ trigger, items, label, align = "end", side = "bottom" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>(UNPOSITIONED);
  const triggerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const dismiss = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, listRef], dismiss);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !listRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = listRef.current.getBoundingClientRect();
    const margin = 8;
    let left = align === "end" ? anchor.right - menu.width : anchor.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menu.width - margin));
    let top = side === "bottom" ? anchor.bottom + 6 : anchor.top - menu.height - 6;
    if (top + menu.height > window.innerHeight - margin) top = Math.max(margin, anchor.top - menu.height - 6);
    if (top < margin) top = anchor.bottom + 6;
    setPosition({ position: "fixed", left, top });
  }, [open, align, side]);

  return (
    <>
      {cloneElement(trigger, {
        ref: triggerRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event);
          setPosition(UNPOSITIONED);
          setOpen((value) => !value);
        },
      })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <MenuList id={menuId} items={items} label={label} onClose={close} style={position} listRef={listRef} />,
            document.body,
          )
        : null}
    </>
  );
}

interface ContextMenuProps {
  /** Viewport coordinates, or null when closed. */
  position: { x: number; y: number } | null;
  items: MenuItem[];
  label: string;
  onClose: () => void;
}

/** A menu opened at a point (right-click, or the keyboard's context-menu key). */
export function ContextMenu({ position, items, label, onClose }: ContextMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(UNPOSITIONED);
  useDismiss(position !== null, [listRef], onClose);

  useLayoutEffect(() => {
    if (!position || !listRef.current) return;
    const menu = listRef.current.getBoundingClientRect();
    const margin = 8;
    setStyle({
      position: "fixed",
      left: Math.max(margin, Math.min(position.x, window.innerWidth - menu.width - margin)),
      top: Math.max(margin, Math.min(position.y, window.innerHeight - menu.height - margin)),
    });
  }, [position]);

  if (!position || typeof document === "undefined") return null;
  return createPortal(
    <MenuList items={items} label={label} onClose={onClose} style={style} listRef={listRef} />,
    document.body,
  );
}
