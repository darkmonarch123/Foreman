"use client";

import { ArrowRight, Sparkles, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  announcementStorageKey,
  parseAnnouncementState,
  type Announcement,
  type AnnouncementState,
} from "@/lib/announcements";

const CHANGE_EVENT = "foreman:announcement-changed";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked: treat as already seen, so nothing nags on every visit.
    return JSON.stringify({ popupSeen: true, dismissed: false });
  }
}

interface WhatsNewAnnouncementProps {
  announcement: Announcement;
  userId: string;
  /** The page that explains the feature. */
  learnMoreHref: string;
}

const HEADLINE = "What’s new on Foreman";
const SUMMARY =
  "Meet Foreman Assistant: it reads your board and points out open questions, missing owners and loose ends, then suggests notes you can preview, edit and accept. It never changes your board on its own.";

/**
 * Announces a new feature after login: a pop-up the first time, then a card on
 * the dashboard until it is closed or the announcement window ends.
 */
export function WhatsNewAnnouncement({ announcement, userId, learnMoreHref }: WhatsNewAnnouncementProps) {
  const key = announcementStorageKey(announcement.id, userId);
  // undefined on the server and during hydration, so nothing flashes before storage is read.
  const raw = useSyncExternalStore<string | null | undefined>(
    subscribe,
    () => read(key),
    () => undefined,
  );

  const update = useCallback(
    (change: Partial<AnnouncementState>) => {
      const next = { ...parseAnnouncementState(read(key)), ...change };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage blocked: it will show again next time, which is harmless.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  if (raw === undefined) return null;
  const state = parseAnnouncementState(raw);

  if (!state.popupSeen) {
    return (
      <Modal
        open
        onClose={() => update({ popupSeen: true })}
        title={HEADLINE}
        description="New this month"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => update({ popupSeen: true })}>
              Maybe later
            </Button>
            <LinkButton href={learnMoreHref} onClick={() => update({ popupSeen: true })}>
              Learn more
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          </>
        }
      >
        <div className="rounded-card bg-lavender-tint p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" aria-hidden />
            Foreman Assistant
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{SUMMARY}</p>
          <p className="mt-3 text-sm text-muted">
            Open any board and press <kbd className="rounded border border-line bg-surface px-1.5 text-xs">F</kbd>, or
            use the Foreman Assistant button in the top bar.
          </p>
        </div>
      </Modal>
    );
  }

  if (state.dismissed) return null;

  return (
    <section
      aria-labelledby="whats-new-heading"
      className="relative mb-10 overflow-hidden rounded-panel bg-lavender-tint px-6 py-7 sm:px-9 sm:py-9"
    >
      <IconButton
        label="Close announcement"
        size="sm"
        onClick={() => update({ dismissed: true })}
        className="absolute right-3 top-3"
      >
        <X className="size-4" aria-hidden />
      </IconButton>
      <div className="max-w-2xl">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium">
          <Sparkles className="size-3.5" aria-hidden />
          New
        </p>
        <h2 id="whats-new-heading" className="mt-4 font-display text-title">
          {HEADLINE}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{SUMMARY}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <LinkButton href={learnMoreHref}>
            Learn more
            <ArrowRight className="size-4" aria-hidden />
          </LinkButton>
          <p className="text-sm text-muted">Press F on any board to open it.</p>
        </div>
      </div>
    </section>
  );
}
