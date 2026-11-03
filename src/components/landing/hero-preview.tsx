"use client";

import { Check, MousePointer2, PenLine, Shapes, StickyNote, MoveUpRight } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { animateSprings, prefersReducedMotion, rubberband, Spring } from "@/lib/spring";

const COLUMNS = [
  {
    name: "Plan",
    tone: "bg-site-plan",
    card: "bg-site-plan-card",
    cards: [
      ["Define the goal", "2 comments"],
      ["Agree on scope", "Ada is editing"],
    ],
  },
  {
    name: "Build",
    tone: "bg-site-build",
    card: "bg-site-build-card",
    cards: [
      ["First deliverable", "Moved by Kemi"],
      ["Timeline check-in", "Edited just now"],
    ],
  },
  { name: "Test", tone: "bg-site-test", card: "bg-site-test-card", cards: [["Review and feedback", "3 comments"]] },
] as const;

const TOOLS = [
  { label: "Select", icon: MousePointer2 },
  { label: "Sticky note", icon: StickyNote },
  { label: "Shape", icon: Shapes },
  { label: "Arrow", icon: MoveUpRight },
  { label: "Pen", icon: PenLine },
];

/**
 * A card you can drag and throw. It follows the pointer 1:1 from where it was grabbed,
 * resists past the canvas edge, and springs home carrying the release velocity, with
 * a little bounce only when it was thrown. It can be caught again mid-flight.
 */
function DraggableCard({ title, meta, className }: { title: string; meta: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({
    x: new Spring(0),
    y: new Spring(0),
    dragging: false,
    stop: null as null | (() => void),
    start: { x: 0, y: 0 },
    history: [] as { x: number; y: number; t: number }[],
  });

  const render = () => {
    const { x, y, dragging } = state.current;
    if (ref.current) {
      ref.current.style.transform =
        `translate3d(${x.value}px, ${y.value}px, 0)` + (dragging ? " scale(1.04) rotate(-1.5deg)" : "");
    }
  };

  useEffect(() => () => state.current.stop?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const s = state.current;
    s.stop?.(); // catch it from wherever it is now
    s.dragging = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    s.start = { x: event.clientX - s.x.value, y: event.clientY - s.y.value };
    s.history = [{ x: event.clientX, y: event.clientY, t: performance.now() }];
    render();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const s = state.current;
    const card = ref.current;
    const canvas = card?.closest<HTMLElement>("[data-canvas]");
    if (!s.dragging || !card || !canvas) return;
    let dx = event.clientX - s.start.x;
    let dy = event.clientY - s.start.y;
    const bounds = canvas.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const left = rect.left - s.x.value;
    const top = rect.top - s.y.value;
    const minX = bounds.left - left;
    const maxX = bounds.right - (left + rect.width);
    const minY = bounds.top - top;
    const maxY = bounds.bottom - (top + rect.height);
    if (dx < minX) dx = minX + rubberband(dx - minX, bounds.width);
    if (dx > maxX) dx = maxX + rubberband(dx - maxX, bounds.width);
    if (dy < minY) dy = minY + rubberband(dy - minY, bounds.height);
    if (dy > maxY) dy = maxY + rubberband(dy - maxY, bounds.height);
    s.x.value = dx;
    s.y.value = dy;
    s.history.push({ x: event.clientX, y: event.clientY, t: performance.now() });
    if (s.history.length > 5) s.history.shift();
    render();
  };

  const release = () => {
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    const first = s.history[0];
    const last = s.history[s.history.length - 1];
    const dt = (last.t - first.t) / 1000;
    s.x.velocity = dt > 0 ? (last.x - first.x) / dt : 0;
    s.y.velocity = dt > 0 ? (last.y - first.y) / dt : 0;
    const thrown = Math.hypot(s.x.velocity, s.y.velocity) > 300;
    s.x.damping = s.y.damping = thrown ? 0.72 : 1;
    s.x.target = s.y.target = 0;
    s.stop = animateSprings([s.x, s.y], render, prefersReducedMotion());
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      className={cn(
        "relative z-[1] mb-2.5 cursor-grab touch-none select-none rounded-site-sm px-4 py-3.5 text-[0.9375rem] shadow-[0_1px_2px_rgb(0_0_0/0.06)] will-change-transform active:cursor-grabbing",
        className,
      )}
    >
      {title}
      <div className="mt-1.5 text-site-caption opacity-70">{meta}</div>
    </div>
  );
}

/** The glass toolbar: the selected tool's highlight springs to the tool you pick. */
function Toolbar() {
  const [selected, setSelected] = useState(0);
  const thumb = useRef<HTMLSpanElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const springs = useRef({
    x: new Spring(0, { damping: 0.72, response: 0.38 }),
    s: new Spring(1, { damping: 0.6, response: 0.3 }),
  });
  const stop = useRef<null | (() => void)>(null);

  const draw = () => {
    const { x, s } = springs.current;
    if (thumb.current) thumb.current.style.transform = `translateX(${x.value}px) scale(${s.value}, ${2 - s.value})`;
  };
  const run = () => {
    stop.current?.();
    stop.current = animateSprings([springs.current.x, springs.current.s], draw, prefersReducedMotion());
  };

  useEffect(() => {
    const release = () => {
      if (springs.current.s.target !== 1) {
        springs.current.s.target = 1;
        run();
      }
    };
    window.addEventListener("pointerup", release);
    return () => {
      window.removeEventListener("pointerup", release);
      stop.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Board tools (preview)"
      className="site-glass absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-full p-1.5"
    >
      <span
        ref={thumb}
        aria-hidden
        className="absolute left-1.5 top-1.5 size-11 rounded-full bg-site-accent/16 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),inset_0_0_0_1px_rgb(0_113_227/0.18)] will-change-transform"
      />
      {TOOLS.map(({ label, icon: Icon }, index) => (
        <button
          key={label}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          aria-label={label}
          aria-pressed={selected === index}
          onPointerDown={() => {
            springs.current.s.target = 1.18;
            run();
          }}
          onClick={(event) => {
            setSelected(index);
            springs.current.x.target = event.currentTarget.offsetLeft - 6;
            springs.current.s.target = 1;
            run();
          }}
          className="relative z-[1] grid size-11 place-items-center rounded-full text-site-label aria-pressed:text-site-link"
        >
          <Icon className="size-5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** The product window under the hero: a real-looking board you can play with. */
export function HeroPreview() {
  return (
    <figure className="m-0">
      <div
        data-window
        className="origin-top overflow-hidden rounded-site-lg border border-black/[0.04] bg-site-surface shadow-site-lg will-change-transform dark:border-white/[0.08]"
      >
        <div className="flex h-12 items-center gap-3.5 border-b border-site-line px-5 text-[0.8125rem]">
          <div aria-hidden className="flex gap-[7px]">
            <i className="block size-[11px] rounded-full bg-[#ff5f57]" />
            <i className="block size-[11px] rounded-full bg-[#febc2e]" />
            <i className="block size-[11px] rounded-full bg-[#28c840]" />
          </div>
          <span className="font-semibold">Project Roadmap</span>
          <span className="hidden text-site-label-2 min-[42.5rem]:inline">Shared with Design team</span>
          <span className="ml-auto flex items-center gap-1.5 font-medium text-site-success">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
            Saved
          </span>
          <div aria-hidden className="ml-3 hidden min-[42.5rem]:flex">
            {[
              ["A", "#a85200"],
              ["K", "#1d7f91"],
              ["T", "#8944ab"],
            ].map(([initial, color]) => (
              <span
                key={initial}
                className="-ml-1.5 grid size-6 place-items-center rounded-full border-2 border-site-surface text-[10px] font-semibold text-white"
                style={{ background: color }}
              >
                {initial}
              </span>
            ))}
          </div>
        </div>
        <div
          data-canvas
          className="site-dots relative grid gap-[1.125rem] bg-site-bg px-[1.375rem] pb-24 pt-[1.375rem] min-[42.5rem]:grid-cols-3 min-[42.5rem]:gap-10 min-[42.5rem]:px-10 min-[42.5rem]:pb-28 min-[42.5rem]:pt-10"
        >
          {COLUMNS.map((column, index) => (
            <div
              key={column.name}
              className={cn("relative rounded-site-md p-[1.375rem] min-[42.5rem]:min-h-64", column.tone)}
            >
              <h3 className="mb-4 flex justify-between text-[1.3125rem] font-semibold tracking-[-0.025em]">
                {column.name}
                <small className="text-[0.8125rem] font-medium opacity-60">{column.cards.length}</small>
              </h3>
              {column.cards.map(([title, meta]) => (
                <DraggableCard key={title} title={title} meta={meta} className={column.card} />
              ))}
              {index < COLUMNS.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute -right-8 top-[2.125rem] hidden h-0.5 w-6 rounded-sm bg-site-label/25 min-[42.5rem]:block"
                />
              ) : null}
            </div>
          ))}
          <Toolbar />
        </div>
      </div>
      <figcaption className="mt-4 text-center text-site-small text-site-label-2">
        Try it: drag a card and let go, or pick a tool.
      </figcaption>
    </figure>
  );
}
