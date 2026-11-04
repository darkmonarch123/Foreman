// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewAnnouncement } from "@/components/app/whats-new-announcement";
import { ASSISTANT_ANNOUNCEMENT, announcementStorageKey } from "@/lib/announcements";

const USER = "user-1";
const KEY = announcementStorageKey(ASSISTANT_ANNOUNCEMENT.id, USER);

function show(userId = USER) {
  return render(
    <WhatsNewAnnouncement announcement={ASSISTANT_ANNOUNCEMENT} userId={userId} learnMoreHref="/whats-new" />,
  );
}

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("What's new announcement", () => {
  it("opens as a pop-up the first time, with Learn more and Maybe later", async () => {
    show();
    const dialog = await screen.findByRole("dialog", { name: "What’s new on Foreman" });
    expect(dialog).toHaveTextContent("Foreman Assistant");
    expect(screen.getByRole("link", { name: /Learn more/ })).toHaveAttribute("href", "/whats-new");
    expect(screen.getByRole("button", { name: "Maybe later" })).toBeInTheDocument();
  });

  it("after the pop-up is closed, shows the dashboard card instead, and never the pop-up again", async () => {
    const user = userEvent.setup();
    const view = show();
    await user.click(await screen.findByRole("button", { name: "Maybe later" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What’s new on Foreman" })).toBeInTheDocument();
    expect(stored()).toEqual({ popupSeen: true, dismissed: false });

    view.unmount();
    show();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "What’s new on Foreman" })).toBeInTheDocument();
  });

  it("closing the pop-up with Escape counts as seen", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(stored()).toEqual({ popupSeen: true, dismissed: false });
  });

  it("following Learn more from the pop-up counts as seen", async () => {
    const user = userEvent.setup();
    show();
    const link = await screen.findByRole("link", { name: /Learn more/ });
    link.addEventListener("click", (event) => event.preventDefault()); // stay on the page in jsdom
    await user.click(link);
    expect(stored().popupSeen).toBe(true);
  });

  it("the card links to the how-to page and stays closed once dismissed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(KEY, JSON.stringify({ popupSeen: true, dismissed: false }));
    const view = show();
    const card = await screen.findByRole("region", { name: "What’s new on Foreman" });
    expect(card.querySelector('a[href="/whats-new"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Close announcement" }));
    expect(screen.queryByRole("region", { name: "What’s new on Foreman" })).not.toBeInTheDocument();
    expect(stored()).toEqual({ popupSeen: true, dismissed: true });

    view.unmount();
    show();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is remembered per user, so someone else on the same browser still sees it", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ popupSeen: true, dismissed: true }));
    show("user-2");
    expect(await screen.findByRole("dialog", { name: "What’s new on Foreman" })).toBeInTheDocument();
  });

  it("does not nag with a pop-up when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show();
    expect(await screen.findByRole("region", { name: "What’s new on Foreman" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
