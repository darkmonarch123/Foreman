// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetNextMocks } from "../support/next-mocks";

vi.mock("next/navigation", async () => (await import("../support/next-mocks")).navigationMock);
const authActions = vi.hoisted(() => ({
  logoutAction: vi.fn(async () => undefined),
  logoutEverywhereAction: vi.fn(async () => undefined),
  setThemePreferenceAction: vi.fn(async (input: { theme: string }) => ({ ok: true, data: input })),
}));
vi.mock("@/lib/auth/actions", () => authActions);

import { ProfileMenu } from "@/components/app/profile-menu";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const profile = {
  first_name: "Ada",
  last_name: "Lovelace",
  username: "ada",
  avatar_url: "",
  email: "ada@example.test",
  theme_preference: "system" as const,
};

beforeEach(() => {
  resetNextMocks();
  vi.clearAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

describe("Account menu", () => {
  it("shows who is signed in and offers settings, theme and both ways to sign out", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu profile={profile} />);
    await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toHaveTextContent("Ada Lovelace");
    expect(menu).toHaveTextContent("ada@example.test");
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "System theme" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out everywhere" })).toBeInTheDocument();
  });

  it("applies a theme immediately, remembers it in this browser and saves it to the account", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu profile={profile} />);
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(authActions.setThemePreferenceAction).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("adopts the account's theme over what this browser remembered", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ProfileMenu profile={{ ...profile, theme_preference: "dark" }} />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(authActions.setThemePreferenceAction).not.toHaveBeenCalled();
  });

  it("signs out everywhere from the menu", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu profile={profile} />);
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out everywhere" }));
    expect(authActions.logoutEverywhereAction).toHaveBeenCalledOnce();
  });
});
