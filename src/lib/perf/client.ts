import { roundMs, type PerfAction, type PerfOutcome } from "./events";

/**
 * Client-side timing: from a person's action to the moment its result is on screen.
 *
 * Events are queued and sent in small batches to /api/perf (our own server; the
 * user id is added there from the session). In development they are also printed,
 * and the last 200 are kept on `window.__foremanPerf` for tests and debugging.
 */

interface QueuedEvent {
  action: PerfAction;
  durationMs: number;
  outcome: PerfOutcome;
  code?: string;
  boardId?: string;
}

declare global {
  interface Window {
    __foremanPerf?: QueuedEvent[];
  }
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush(): void {
  flushTimer = null;
  if (queue.length === 0 || typeof window === "undefined") return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ events });
  try {
    if (!navigator.sendBeacon?.("/api/perf", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/perf", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "application/json" },
      });
    }
  } catch {
    // Timing is best effort; never let it affect the product.
  }
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (!flushTimer) flushTimer = setTimeout(flush, 5_000);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", flush);
  }
}

export function recordPerf(event: QueuedEvent): void {
  if (typeof window === "undefined") return;
  const entry = { ...event, durationMs: roundMs(event.durationMs) };
  const history = (window.__foremanPerf ??= []);
  history.push(entry);
  if (history.length > 200) history.shift();
  if (process.env.NODE_ENV === "development")
    console.debug("[perf]", entry.action, `${entry.durationMs}ms`, entry.outcome);
  if (process.env.NODE_ENV === "test") return;
  queue.push(entry);
  if (queue.length >= 20) flush();
  else schedule();
}

/** Resolves after the browser has painted the current update (two animation frames). */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "undefined") return resolve();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface PerfTimer {
  /** Ends the timer now. */
  end(outcome?: PerfOutcome, code?: string): void;
  /** Ends the timer once the current update is on screen. */
  endAfterPaint(outcome?: PerfOutcome, code?: string): void;
}

export function startTimer(action: PerfAction, context: { boardId?: string; startedAt?: number } = {}): PerfTimer {
  const started = context.startedAt ?? performance.now();
  let done = false;
  const end = (outcome: PerfOutcome = "ok", code?: string) => {
    if (done) return;
    done = true;
    recordPerf({ action, durationMs: performance.now() - started, outcome, code, boardId: context.boardId });
  };
  return {
    end,
    endAfterPaint(outcome, code) {
      void afterPaint().then(() => end(outcome, code));
    },
  };
}

/** Test helper: forget queued events. */
export function resetPerfForTests(): void {
  queue.length = 0;
  if (typeof window !== "undefined") window.__foremanPerf = [];
}
