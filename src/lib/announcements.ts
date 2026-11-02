/**
 * Product announcements ("What's new on Foreman").
 *
 * An announcement runs for a fixed window and is shown only while the feature it
 * announces is enabled. Whether someone has seen or closed it is remembered in
 * this browser only (localStorage), per user, so nothing about it is stored on
 * the server.
 */

export interface Announcement {
  /** Stable id; part of the storage key, so changing it shows the announcement again. */
  id: string;
  /** Inclusive start of the window. */
  startsAt: string;
  /** Exclusive end of the window. */
  endsAt: string;
}

/** Foreman Assistant launch: 30 days from 2 November 2026 (West Africa Time). */
export const ASSISTANT_ANNOUNCEMENT: Announcement = {
  id: "assistant-v1",
  startsAt: "2026-11-02T00:00:00+01:00",
  endsAt: "2026-12-02T00:00:00+01:00",
};

export function isAnnouncementActive(announcement: Announcement, now: Date = new Date()): boolean {
  const time = now.getTime();
  return time >= Date.parse(announcement.startsAt) && time < Date.parse(announcement.endsAt);
}

export interface AnnouncementState {
  /** The pop-up has been shown and closed. */
  popupSeen: boolean;
  /** The dashboard card has been closed. */
  dismissed: boolean;
}

export const EMPTY_ANNOUNCEMENT_STATE: AnnouncementState = { popupSeen: false, dismissed: false };

export function announcementStorageKey(announcementId: string, userId: string): string {
  return `foreman:announcement:${announcementId}:${userId}`;
}

/** Reads a stored state defensively: anything malformed counts as "not seen". */
export function parseAnnouncementState(raw: string | null | undefined): AnnouncementState {
  if (!raw) return EMPTY_ANNOUNCEMENT_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY_ANNOUNCEMENT_STATE;
    const record = value as Record<string, unknown>;
    return { popupSeen: record.popupSeen === true, dismissed: record.dismissed === true };
  } catch {
    return EMPTY_ANNOUNCEMENT_STATE;
  }
}

/** The Assistant announcement shows only while the Assistant is on and its window is open. */
export function shouldAnnounceAssistant(assistantEnabled: boolean, now: Date = new Date()): boolean {
  return assistantEnabled && isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, now);
}

/**
 * Where "Try it on a board" goes: the most recently updated board with the Assistant open,
 * or creating a board when there is none. A failed lookup falls back to the dashboard.
 */
export async function tryAssistantHref(loadBoards: () => Promise<readonly { id: string }[]>): Promise<string> {
  try {
    const [latest] = await loadBoards();
    return latest ? `/boards/${latest.id}?assistant=open` : "/boards/new";
  } catch {
    return "/dashboard";
  }
}
