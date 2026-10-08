"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatRelative(date: Date, now: Date): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 30) return formatter.format(Math.round(seconds / 86_400), "day");
  if (abs < 86_400 * 365) return formatter.format(Math.round(seconds / (86_400 * 30)), "month");
  return formatter.format(Math.round(seconds / (86_400 * 365)), "year");
}

/** "5 minutes ago", kept current, with the exact time available on hover and to assistive technology. */
export function RelativeTime({ date, className }: { date: string; className?: string }) {
  const parsed = new Date(date);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (Number.isNaN(parsed.getTime())) return null;
  const exact = absolute.format(parsed);
  return (
    <time dateTime={parsed.toISOString()} title={exact} className={className} suppressHydrationWarning>
      {now ? formatRelative(parsed, now) : exact}
    </time>
  );
}
