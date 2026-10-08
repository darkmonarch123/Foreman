// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { RoleBadge, StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Toggle } from "@/components/ui/field";
import { DropdownMenu } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Wordmark } from "@/components/ui/wordmark";
import { cn } from "@/lib/cn";

describe("Wordmark", () => {
  it("renders the spaced lowercase mark with an accessible name", () => {
    render(<Wordmark />);
    const mark = screen.getByRole("img", { name: "Foreman" });
    expect(mark).toHaveTextContent("foreman");
    expect(mark.querySelector(".wordmark")).not.toBeNull();
  });
});

describe("Button", () => {
  it("is disabled and announces busy while loading", () => {
    render(
      <Button loading loadingLabel="Saving">
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("requires a label for icon-only buttons", () => {
    render(<IconButton label="Delete">×</IconButton>);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Delete");
  });

  it("lets a caller's class override a default", () => {
    expect(cn("h-8 px-3", "h-10")).toBe("px-3 h-10");
    expect(cn("text-headline text-muted")).toBe("text-headline text-muted");
  });
});

describe("badges", () => {
  it("always writes the role out in text", () => {
    render(
      <>
        <RoleBadge role="OWNER" />
        <RoleBadge role="EDITOR" />
        <RoleBadge role="VIEWER" />
      </>,
    );
    for (const label of ["Owner", "Editor", "Viewer"]) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("announces every save state as a polite status with a text label", () => {
    const labels = {
      saved: "Saved",
      saving: "Saving",
      offline: "Offline",
      reconnecting: "Reconnecting",
      failed: "Sync failed",
      "view-only": "View only",
    } as const;
    for (const [status, label] of Object.entries(labels)) {
      const { unmount } = render(<StatusBadge status={status as keyof typeof labels} />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute("aria-live", "polite");
      unmount();
    }
  });
});

describe("Avatar", () => {
  const person = { first_name: "Ada", last_name: "Okafor", avatar_url: "/api/avatar/female/abcdef1234567890" };

  it("uses the person's name as the image description and states presence in text", () => {
    render(<Avatar person={person} online />);
    expect(screen.getByRole("img", { name: "Ada Okafor" })).toHaveAttribute("src", person.avatar_url);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("refuses to load an avatar from anywhere but the local generator", () => {
    render(<Avatar person={{ ...person, avatar_url: "https://tracker.example/pixel.png" }} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Ada Okafor" })).toHaveTextContent("A");
  });

  it("summarises a stack, including people not shown", () => {
    const people = Array.from({ length: 3 }, (_, index) => ({
      ...person,
      user_id: String(index),
      first_name: `P${index}`,
    }));
    render(<AvatarStack people={people} total={7} max={3} />);
    expect(screen.getByRole("group", { name: "P0 Okafor, P1 Okafor, P2 Okafor and 4 more" })).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });
});

describe("Input", () => {
  it("links hint and error text to the field", () => {
    const { rerender } = render(<Input label="Username" hint="Lowercase only" />);
    const input = screen.getByLabelText("Username");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent("Lowercase only");
    rerender(<Input label="Username" hint="Lowercase only" error="Taken" />);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Taken");
  });

  it("exposes toggles as switches", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Share link" description="A private link" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Share link" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

function ModalHarness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Share board"
        description="Choose who can see it"
        footer={<button type="button">Done</button>}
      >
        <input aria-label="Email" />
        <button type="button">Invite</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("is a labelled modal dialog and moves focus inside when opened", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Share board" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Choose who can see it");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ModalHarness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it("stops the page behind from scrolling while open", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Tabs", () => {
  function Harness() {
    const [value, setValue] = useState("a");
    return (
      <Tabs
        label="Sections"
        value={value}
        onChange={setValue}
        tabs={[
          { id: "a", label: "First" },
          { id: "b", label: "Second" },
          { id: "c", label: "Third", count: 2 },
        ]}
      >
        <p>Panel {value}</p>
      </Tabs>
    );
  }

  it("follows the tabs keyboard pattern", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "First" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("tabindex", "-1");

    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel b");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Third/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("First");
  });
});

describe("DropdownMenu", () => {
  it("opens as a menu, supports arrow keys and returns focus on Escape", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="Board actions"
        trigger={<button type="button">Actions</button>}
        items={[
          { id: "rename", label: "Rename", onSelect: onRename },
          { id: "share", label: "Share", onSelect: () => {}, disabled: true },
          { id: "delete", label: "Delete", onSelect: onDelete, danger: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Board actions" });
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveFocus();

    // Disabled items are skipped.
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("Toast and empty state", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast.success("Board renamed.")}>
          ok
        </button>
        <button type="button" onClick={() => toast.error("Couldn't save.")}>
          bad
        </button>
      </>
    );
  }

  it("announces success politely and errors assertively, and can be dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ok" }));
    expect(screen.getByRole("status")).toHaveTextContent("Board renamed.");
    await user.click(screen.getByRole("button", { name: "bad" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save.");
    await user.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0]);
    expect(screen.queryByText("Board renamed.")).toBeNull();
  });

  it("renders an empty state with a next step", () => {
    render(
      <EmptyState
        title="No comments yet"
        description="Start the conversation."
        action={<button type="button">Add comment</button>}
      />,
    );
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add comment" })).toBeInTheDocument();
  });
});
