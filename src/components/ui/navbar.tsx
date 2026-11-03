"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { LinkButton } from "./button";
import { Wordmark } from "./wordmark";

export interface NavLink {
  href: string;
  label: string;
}

interface NavbarProps {
  links: NavLink[];
  login: NavLink;
  signup: NavLink;
}

/**
 * Floating glass navigation for the public site.
 *
 * - Large screens: links inline. Smaller screens: a menu button opens a panel that
 *   grows out of the button; Escape, a link, or a click outside closes it and focus
 *   returns to the button.
 * - Narrows a little once the page scrolls, and switches to a dark tint while it
 *   floats over a dark section (elements marked data-surface="dark").
 * - Sits below the status bar / notch (safe-area inset). Every target is >= 44px.
 */
export function Navbar({ links, login, signup }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [onDark, setOnDark] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCompact(window.scrollY > 80);
      const header = headerRef.current;
      if (!header) return;
      const rect = header.getBoundingClientRect();
      const under = document.elementsFromPoint(window.innerWidth / 2, rect.bottom + 4);
      setOnDark(under.some((element) => element instanceof HTMLElement && element.dataset.surface === "dark"));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) buttonRef.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    // The panel is for small screens only; widening the window closes it.
    const wide = window.matchMedia("(min-width: 64rem)");
    const onWide = () => wide.matches && close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex flex-col items-center px-[max(0.75rem,env(safe-area-inset-left))]">
      <header
        ref={headerRef}
        data-compact={compact}
        data-on-dark={onDark}
        className={cn(
          "site-glass pointer-events-auto flex h-14 w-full max-w-[65rem] items-center gap-2 rounded-full pl-5 pr-1.5",
          "transition-[max-width,height,background-color,color] duration-500 ease-site-spring motion-reduce:transition-none",
          "data-[compact=true]:h-[3.25rem] data-[compact=true]:lg:max-w-[47.5rem]",
          "data-[on-dark=true]:bg-[rgb(40_40_44/0.55)] data-[on-dark=true]:text-[#f5f5f7]",
        )}
      >
        <Link
          href="/"
          aria-label="Foreman home"
          className="-ml-2 inline-flex h-11 shrink-0 items-center rounded-full px-2"
        >
          <Wordmark className="text-[1.0625rem]" />
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-full px-3 text-[0.8125rem] opacity-80 transition-[opacity,background-color] hover:bg-white/45 hover:opacity-100 dark:hover:bg-white/10"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          <Link
            href={login.href}
            className="hidden h-11 items-center rounded-full px-3 text-[0.8125rem] opacity-80 hover:opacity-100 sm:inline-flex"
          >
            {login.label}
          </Link>
          <LinkButton href={signup.href} variant="accent" className="h-11 px-4 text-[0.8125rem]">
            {signup.label}
          </LinkButton>
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/45 lg:hidden dark:hover:bg-white/10"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </header>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="site-glass pointer-events-auto mt-2 w-full max-w-[65rem] origin-top-right rounded-site-lg p-2 lg:hidden motion-safe:animate-pop-in"
      >
        <nav aria-label="Menu">
          <ul className="flex flex-col">
            {[...links, login].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center rounded-site-sm px-4 text-site-body hover:bg-white/45 dark:hover:bg-white/10"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
