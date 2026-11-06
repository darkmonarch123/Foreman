"use client";

import { useEffect } from "react";
import type { PerfAction } from "@/lib/perf/events";
import { startTimer } from "@/lib/perf/client";

/**
 * Records how long a page took to show its content: from the start of the page
 * load to the first paint after this component mounts. Renders nothing.
 */
export function PerfMark({ action, boardId }: { action: PerfAction; boardId?: string }) {
  useEffect(() => {
    startTimer(action, { boardId, startedAt: 0 }).endAfterPaint();
  }, [action, boardId]);
  return null;
}
