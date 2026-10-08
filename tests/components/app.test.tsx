// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetNextMocks, router, setSearchParams } from "../support/next-mocks";

vi.mock("next/navigation", async () => (await import("../support/next-mocks")).navigationMock);
vi.mock("next/link", async () => ({ default: (await import("../support/next-mocks")).LinkMock }));

const boardActions = vi.hoisted(() => ({
  createBoardAction: vi.fn(),
  updateBoardAction: vi.fn(),
  deleteBoardAction: vi.fn(),
  restoreBoardAction: vi.fn(),
  purgeBoardAction: vi.fn(),
  duplicateBoardAction: vi.fn(),
  leaveBoardAction: vi.fn(),
  joinBoardAction: vi.fn(),
  acceptInvitationAction: vi.fn(),
  declineInvitationAction: vi.fn(),
  decideJoinRequestAction: vi.fn(),
}));
vi.mock("@/lib/boards/actions", () => boardActions);
const authActions = vi.hoisted(() => ({
  recordCookieConsentAction: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("@/lib/auth/actions", () => authActions);

import { AcceptInvitation } from "@/components/app/accept-invitation";
import { BoardCard } from "@/components/app/board-card";
import { CreateBoardForm } from "@/components/app/create-board-form";
import { JoinForm } from "@/components/app/join-form";
import { TemplateGallery } from "@/components/app/template-gallery";
import { CookieConsent } from "@/components/cookie-consent";
import { ToastProvider } from "@/components/ui/toast";
import type { BoardListItem, TemplateRow } from "@/lib/boards/types";
import { CONSENT_STORAGE_KEY, CONSENT_VERSION } from "@/lib/consent";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

function templateRow(slug: string, overrides: Partial<TemplateRow> = {}): TemplateRow {
  const definition = TEMPLATE_CATALOG.find((template) => template.slug === slug)!;
  return {
    id: slug,
    slug,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    min_plan: definition.minPlan,
    is_featured: definition.featured,
    sort_order: definition.sortOrder,
    content: definition.content,
    ...overrides,
  };
}

function board(overrides: Partial<BoardListItem> = {}): BoardListItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Foreman Launch Plan",
    description: "",
    access_mode: "INVITE_ONLY",
    owner_id: "a",
    role: "OWNER",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    member_count: 2,
    members: [
      { user_id: "a", first_name: "Ada", last_name: "Okafor", avatar_url: "/api/avatar/female/aaaaaaaaaaaaaaaa" },
      { user_id: "b", first_name: "Ben", last_name: "Mensah", avatar_url: "/api/avatar/male/bbbbbbbbbbbbbbbb" },
    ],
    preview: [{ type: "STICKY_NOTE", x: 0, y: 0, width: 100, height: 80, fill: "#F8DD72", stroke: null }],
    ...overrides,
  };
}

beforeEach(() => {
  resetNextMocks();
  for (const action of Object.values(boardActions)) action.mockReset();
  window.localStorage.clear();
});

describe("create board form", () => {
  it("requires a board name", async () => {
    const user = userEvent.setup();
    render(<CreateBoardForm template={null} />);
    await user.click(screen.getByRole("button", { name: "Create board" }));
    expect(await screen.findByText("Give the board a name.")).toBeInTheDocument();
    expect(boardActions.createBoardAction).not.toHaveBeenCalled();
  });

  it("creates a board from the selected template and opens it", async () => {
    boardActions.createBoardAction.mockResolvedValue({
      ok: true,
      data: { id: "new-board", collaboration_code: "F-1WE-23XX" },
    });
    const user = userEvent.setup();
    render(<CreateBoardForm template={templateRow("project-roadmap")} />);
    // The selected template is summarised.
    expect(screen.getAllByText("Project Roadmap").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Preview of the Project Roadmap template" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Board name"), "Foreman Launch Plan");
    await user.click(screen.getByRole("button", { name: "Create board" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/boards/new-board"));
    expect(boardActions.createBoardAction).toHaveBeenCalledWith({
      title: "Foreman Launch Plan",
      description: "",
      accessMode: "PRIVATE",
      templateSlug: "project-roadmap",
    });
  });

  it("offers the four access modes, private by default", async () => {
    boardActions.createBoardAction.mockResolvedValue({ ok: true, data: { id: "x", collaboration_code: "F-1WE-23XX" } });
    const user = userEvent.setup();
    render(<CreateBoardForm template={null} />);
    expect(screen.getByRole("radio", { name: /^Private/ })).toBeChecked();
    for (const name of [/^Invite only/, /Anyone with the link can view/, /Anyone with the link can request access/]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("radio", { name: /request access/ }));
    await user.type(screen.getByLabelText("Board name"), "Workshop");
    await user.click(screen.getByRole("button", { name: "Create board" }));
    await waitFor(() =>
      expect(boardActions.createBoardAction).toHaveBeenCalledWith(
        expect.objectContaining({ accessMode: "LINK_REQUEST_ACCESS", templateSlug: null }),
      ),
    );
  });

  it("shows the server's reason when creation fails", async () => {
    boardActions.createBoardAction.mockResolvedValue({
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email address to use this feature.",
    });
    const user = userEvent.setup();
    render(<CreateBoardForm template={null} />);
    await user.type(screen.getByLabelText("Board name"), "Plan");
    await user.click(screen.getByRole("button", { name: "Create board" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email address to use this feature.");
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("template gallery", () => {
  const templates = [
    templateRow("project-roadmap"),
    templateRow("study-planner"),
    templateRow("system-design-canvas", { min_plan: "PLUS" }),
  ];

  it("lists templates with a way to use each one", () => {
    render(<TemplateGallery templates={templates} plan="FREE" />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByRole("heading", { name: "Project Roadmap" })).toBeInTheDocument();
    expect(within(cards[0]).getByRole("link", { name: "Use this template" })).toHaveAttribute(
      "href",
      "/boards/new?template=project-roadmap",
    );
  });

  it("locks templates the plan does not include", () => {
    render(<TemplateGallery templates={templates} plan="FREE" />);
    const locked = screen.getAllByRole("article")[2];
    expect(within(locked).getByText("Plus plan")).toBeInTheDocument();
    expect(within(locked).queryByRole("link", { name: "Use this template" })).toBeNull();
  });

  it("unlocks them for an entitled plan", () => {
    render(<TemplateGallery templates={templates} plan="PLUS" />);
    const card = screen.getAllByRole("article")[2];
    expect(within(card).queryByText("Plus plan")).toBeNull();
    expect(within(card).getByRole("link", { name: "Use this template" })).toBeInTheDocument();
  });

  it("opens a preview dialog that says the content is sample content", async () => {
    const user = userEvent.setup();
    render(<TemplateGallery templates={templates} plan="FREE" />);
    await user.click(within(screen.getAllByRole("article")[0]).getByRole("button", { name: "Preview" }));
    const dialog = screen.getByRole("dialog", { name: "Project Roadmap" });
    expect(within(dialog).getByText(/Everything on a template is sample content/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Use this template" })).toHaveAttribute(
      "href",
      "/boards/new?template=project-roadmap",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("join form", () => {
  it("normalises the code and shows the generic unavailable message", async () => {
    boardActions.joinBoardAction.mockResolvedValue({ ok: true, data: { status: "UNAVAILABLE" } });
    const user = userEvent.setup();
    render(<JoinForm />);
    const input = screen.getByLabelText("Collaboration code");
    await user.type(input, "  f-1we-23xx ");
    expect(input).toHaveValue("  F-1WE-23XX ");
    await user.click(screen.getByRole("button", { name: "Join board" }));
    expect(await screen.findByText("Board not found or access is unavailable.")).toBeInTheDocument();
    // Leaving the field trims it; the server normalises again.
    expect(boardActions.joinBoardAction).toHaveBeenCalledWith({ code: "F-1WE-23XX" });
    // No link to a board is offered.
    expect(screen.queryByRole("link", { name: "Open board" })).toBeNull();
  });

  it.each([
    ["REQUEST_SUBMITTED", "Request submitted", false],
    ["PENDING_APPROVAL", "Your request is waiting for approval", false],
    ["ACCESS_DENIED", "Access denied", false],
    ["RATE_LIMITED", "Too many attempts", false],
    ["JOINED_VIEWER", "You joined as a viewer", true],
    ["ALREADY_MEMBER", "You’re already on this board", true],
  ] as const)("shows the %s state", async (status, heading, hasLink) => {
    boardActions.joinBoardAction.mockResolvedValue({
      ok: true,
      data: { status, ...(hasLink ? { board_id: "b1" } : {}) },
    });
    const user = userEvent.setup();
    render(<JoinForm />);
    await user.type(screen.getByLabelText("Collaboration code"), "F-1WE-23XX");
    await user.click(screen.getByRole("button", { name: "Join board" }));
    expect(await screen.findByText(heading)).toBeInTheDocument();
    if (hasLink) expect(screen.getByRole("link", { name: "Open board" })).toHaveAttribute("href", "/boards/b1");
    else expect(screen.queryByRole("link", { name: "Open board" })).toBeNull();
  });

  it("prefills a code from the link and asks before using a share link", async () => {
    setSearchParams("code=f-2ab-34cd");
    const { unmount } = render(<JoinForm />);
    expect(screen.getByLabelText("Collaboration code")).toHaveValue("F-2AB-34CD");
    unmount();

    boardActions.joinBoardAction.mockResolvedValue({ ok: true, data: { status: "JOINED_VIEWER", board_id: "b2" } });
    setSearchParams(`token=${"a".repeat(64)}`);
    const user = userEvent.setup();
    render(<JoinForm />);
    // Nothing happens until the person chooses to continue.
    expect(boardActions.joinBoardAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(boardActions.joinBoardAction).toHaveBeenCalledWith({ token: "a".repeat(64) });
    expect(await screen.findByText("You joined as a viewer")).toBeInTheDocument();
  });
});

describe("invitation acceptance", () => {
  it.each([
    ["This invitation has expired. Ask the board owner to send a new one."],
    ["This invitation was withdrawn by the board owner."],
    ["This invitation has already been accepted."],
  ])("shows: %s", async (message) => {
    boardActions.acceptInvitationAction.mockResolvedValue({ ok: false, code: "INVITATION_EXPIRED", message });
    setSearchParams(`token=${"b".repeat(64)}`);
    const user = userEvent.setup();
    render(<AcceptInvitation />);
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("opens the board after accepting", async () => {
    boardActions.acceptInvitationAction.mockResolvedValue({ ok: true, data: { board_id: "b9", role: "EDITOR" } });
    setSearchParams(`token=${"b".repeat(64)}`);
    const user = userEvent.setup();
    render(<AcceptInvitation />);
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/boards/b9"));
  });

  it("rejects a malformed token without asking the server", () => {
    setSearchParams("token=not-a-token");
    render(<AcceptInvitation />);
    expect(screen.getByRole("alert")).toHaveTextContent("This invitation isn’t available.");
    expect(boardActions.acceptInvitationAction).not.toHaveBeenCalled();
  });
});

describe("board card", () => {
  async function menuLabels(role: BoardListItem["role"], overrides: Partial<BoardListItem> = {}) {
    const user = userEvent.setup();
    const { unmount } = render(
      <ToastProvider>
        <BoardCard board={board({ role, ...overrides })} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Foreman Launch Plan" }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    unmount();
    return labels;
  }

  it("shows the title, role, last update and member avatars", () => {
    render(
      <ToastProvider>
        <BoardCard board={board()} />
      </ToastProvider>,
    );
    expect(screen.getByRole("link", { name: "Foreman Launch Plan" })).toHaveAttribute(
      "href",
      "/boards/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Ada Okafor, Ben Mensah" })).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("offers actions by permission", async () => {
    expect(await menuLabels("OWNER")).toEqual(["Rename", "Share", "Duplicate", "Delete"]);
    expect(await menuLabels("EDITOR")).toEqual(["Duplicate", "Leave board"]);
    expect(await menuLabels("VIEWER")).toEqual(["Leave board"]);
    expect(await menuLabels("OWNER", { deleted_at: new Date().toISOString() })).toEqual(["Restore", "Delete forever"]);
  });

  it("confirms before deleting, and reports the result", async () => {
    boardActions.deleteBoardAction.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <BoardCard board={board()} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Foreman Launch Plan" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(boardActions.deleteBoardAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Move this board to Trash?" });
    await user.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() =>
      expect(boardActions.deleteBoardAction).toHaveBeenCalledWith({ boardId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(await screen.findByText("Board moved to Trash.")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the rename dialog open with the error when renaming fails", async () => {
    boardActions.updateBoardAction.mockResolvedValue({
      ok: false,
      code: "BOARD_ACCESS_DENIED",
      message: "You do not have access to this board.",
    });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <BoardCard board={board()} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Foreman Launch Plan" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Board name");
    await user.clear(field);
    await user.type(field, "New name");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("You do not have access to this board.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Rename board" })).toBeInTheDocument();
  });
});

describe("cookie consent", () => {
  it("offers accept, reject and manage, and links to the policy", async () => {
    render(<CookieConsent />);
    const banner = await screen.findByRole("region", { name: "Cookie preferences" });
    expect(within(banner).getByRole("button", { name: "Accept optional cookies" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Reject optional cookies" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Manage preferences" })).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: "Cookie policy" })).toHaveAttribute("href", "/cookies");
  });

  it("stores a rejection with a version and timestamp and hides the banner", async () => {
    const user = userEvent.setup();
    render(<CookieConsent />);
    await user.click(await screen.findByRole("button", { name: "Reject optional cookies" }));
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY)!);
    expect(stored).toMatchObject({ version: CONSENT_VERSION, analytics: false, preferences: false });
    expect(Number.isNaN(Date.parse(stored.decidedAt))).toBe(false);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cookie preferences" })).toBeNull());
    expect(authActions.recordCookieConsentAction).toHaveBeenCalledWith({
      version: CONSENT_VERSION,
      analytics: false,
      preferences: false,
    });
  });

  it("lets the person choose categories, with essential cookies always on", async () => {
    const user = userEvent.setup();
    render(<CookieConsent />);
    await user.click(await screen.findByRole("button", { name: "Manage preferences" }));
    const dialog = screen.getByRole("dialog", { name: "Cookie preferences" });
    expect(within(dialog).getByRole("switch", { name: "Essential" })).toBeDisabled();
    expect(within(dialog).getByRole("switch", { name: "Analytics" })).toHaveAttribute("aria-checked", "false");
    await user.click(within(dialog).getByRole("switch", { name: "Preferences" }));
    await user.click(within(dialog).getByRole("button", { name: "Save preferences" }));
    expect(JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY)!)).toMatchObject({
      analytics: false,
      preferences: true,
    });
  });

  it("does not show the banner again once a choice exists", async () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_VERSION,
        analytics: false,
        preferences: false,
        decidedAt: new Date().toISOString(),
      }),
    );
    render(<CookieConsent />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("region", { name: "Cookie preferences" })).toBeNull();
  });
});
