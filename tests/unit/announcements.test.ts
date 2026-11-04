import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ANNOUNCEMENT,
  announcementStorageKey,
  isAnnouncementActive,
  parseAnnouncementState,
  shouldAnnounceAssistant,
  tryAssistantHref,
} from "@/lib/announcements";

const at = (iso: string) => new Date(iso);

describe("announcement window", () => {
  it("runs for exactly 30 days from 2 November 2026 (West Africa Time)", () => {
    const days = (Date.parse(ASSISTANT_ANNOUNCEMENT.endsAt) - Date.parse(ASSISTANT_ANNOUNCEMENT.startsAt)) / 86_400_000;
    expect(days).toBe(30);
  });

  it("is inactive before it starts, active inside, and inactive from the end", () => {
    expect(isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, at("2026-11-01T22:59:59Z"))).toBe(false);
    expect(isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, at("2026-11-01T23:00:00Z"))).toBe(true); // 00:00 WAT
    expect(isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, at("2026-11-20T12:00:00Z"))).toBe(true);
    expect(isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, at("2026-12-01T22:59:59Z"))).toBe(true);
    expect(isAnnouncementActive(ASSISTANT_ANNOUNCEMENT, at("2026-12-01T23:00:00Z"))).toBe(false);
  });

  it("never announces the Assistant while it is switched off", () => {
    expect(shouldAnnounceAssistant(false, at("2026-11-10T12:00:00Z"))).toBe(false);
    expect(shouldAnnounceAssistant(true, at("2026-11-10T12:00:00Z"))).toBe(true);
    expect(shouldAnnounceAssistant(true, at("2026-12-10T12:00:00Z"))).toBe(false);
  });
});

describe("remembered state", () => {
  it("is keyed per announcement and per user", () => {
    expect(announcementStorageKey("assistant-v1", "user-1")).toBe("foreman:announcement:assistant-v1:user-1");
    expect(announcementStorageKey("assistant-v1", "user-2")).not.toBe(announcementStorageKey("assistant-v1", "user-1"));
  });

  it("reads stored state and treats anything malformed as not seen", () => {
    expect(parseAnnouncementState('{"popupSeen":true,"dismissed":true}')).toEqual({ popupSeen: true, dismissed: true });
    expect(parseAnnouncementState('{"popupSeen":true}')).toEqual({ popupSeen: true, dismissed: false });
    for (const raw of [null, undefined, "", "not json", "42", "null", '{"popupSeen":"yes"}']) {
      expect(parseAnnouncementState(raw)).toEqual({ popupSeen: false, dismissed: false });
    }
  });
});

describe("Try it on a board", () => {
  it("opens the most recently updated board with the Assistant panel open", async () => {
    expect(await tryAssistantHref(async () => [{ id: "b1" }, { id: "b2" }])).toBe("/boards/b1?assistant=open");
  });

  it("offers to create a board when there is none", async () => {
    expect(await tryAssistantHref(async () => [])).toBe("/boards/new");
  });

  it("falls back to the dashboard if boards cannot be loaded", async () => {
    expect(
      await tryAssistantHref(async () => {
        throw new Error("down");
      }),
    ).toBe("/dashboard");
  });
});
