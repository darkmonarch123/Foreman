// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityPanel, CommentsPanel, OutlinePanel, PeoplePanel } from "@/components/board/side-panel";
import type { ActivityItem, BoardComment, Member } from "@/lib/board/services";
import type { CanvasObject } from "@/lib/board/types";

const ada: Member = {
  user_id: "a",
  role: "OWNER",
  first_name: "Ada",
  last_name: "Okafor",
  username: "ada",
  avatar_url: "/api/avatar/female/aaaaaaaaaaaaaaaa",
  joined_at: "",
};
const ben: Member = {
  user_id: "b",
  role: "EDITOR",
  first_name: "Ben",
  last_name: "Mensah",
  username: "ben",
  avatar_url: "/api/avatar/male/bbbbbbbbbbbbbbbb",
  joined_at: "",
};
const vic: Member = {
  user_id: "c",
  role: "VIEWER",
  first_name: "Vic",
  last_name: "Adeyemi",
  username: "vic",
  avatar_url: "/api/avatar/female/cccccccccccccccc",
  joined_at: "",
};

function note(id: string, text: string): CanvasObject {
  return {
    id,
    type: "STICKY_NOTE",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    z_index: 1,
    props: { text },
    version: 1,
    deleted: false,
    created_by: null,
    updated_by: null,
    updated_at: "",
  };
}

function comment(overrides: Partial<BoardComment> = {}): BoardComment {
  return {
    id: "c1",
    board_id: "board",
    author_id: "a",
    object_id: null,
    body: "Looks good",
    created_at: new Date().toISOString(),
    edited_at: null,
    author: { first_name: "Ada", last_name: "Okafor", avatar_url: ada.avatar_url },
    ...overrides,
  };
}

const commentDefaults = {
  error: null,
  hasMore: false,
  loadingMore: false,
  onLoadMore: () => {},
  onRetry: () => {},
  currentUserId: "a",
  target: null,
  onClearTarget: () => {},
  objectsById: new Map<string, CanvasObject>(),
  onFocusObject: () => {},
  onAdd: async () => {},
  onEdit: async () => {},
  onDelete: async () => {},
};

describe("People panel", () => {
  it("shows real members with roles and separates online from offline", () => {
    render(
      <PeoplePanel
        members={[ada, ben, vic]}
        onlineIds={new Set(["a", "b"])}
        currentUserId="a"
        isOwner
        onInvite={() => {}}
      />,
    );
    const online = screen.getByRole("region", { name: "Online now" });
    expect(within(online).getByText("Ada Okafor")).toBeInTheDocument();
    expect(within(online).getByText("(you)")).toBeInTheDocument();
    expect(within(online).getByText("Ben Mensah")).toBeInTheDocument();
    expect(within(online).getByText("Editor")).toBeInTheDocument();
    const offline = screen.getByRole("region", { name: "Offline" });
    expect(within(offline).getByText("Vic Adeyemi")).toBeInTheDocument();
    expect(within(offline).getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByText("No one else is on the board right now.")).toBeNull();
  });

  it("says so honestly when nobody else is online", () => {
    render(
      <PeoplePanel
        members={[ada, ben]}
        onlineIds={new Set(["a"])}
        currentUserId="a"
        isOwner={false}
        onInvite={() => {}}
      />,
    );
    expect(screen.getByText("No one else is on the board right now.")).toBeInTheDocument();
    // Only the owner gets the invite action.
    expect(screen.queryByRole("button", { name: "Invite people" })).toBeNull();
  });

  it("never shows email addresses", () => {
    const { container } = render(
      <PeoplePanel
        members={[ada, ben, vic]}
        onlineIds={new Set(["a"])}
        currentUserId="a"
        isOwner
        onInvite={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("@example");
  });
});

describe("Comments panel", () => {
  it("shows an honest empty state", () => {
    render(<CommentsPanel {...commentDefaults} comments={[]} canComment />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("shows a loading state before comments arrive", () => {
    render(<CommentsPanel {...commentDefaults} comments={null} canComment />);
    expect(screen.getByRole("status", { name: "Loading comments" })).toBeInTheDocument();
  });

  it("rejects an empty comment without calling the server", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<CommentsPanel {...commentDefaults} comments={[]} canComment onAdd={onAdd} />);
    await user.type(screen.getByLabelText("Add a comment"), "   ");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write a comment first.");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("posts a trimmed comment, attached to the targeted object", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onClearTarget = vi.fn();
    const target = note("o1", "Launch checklist");
    const user = userEvent.setup();
    render(
      <CommentsPanel
        {...commentDefaults}
        comments={[]}
        canComment
        target={target}
        onAdd={onAdd}
        onClearTarget={onClearTarget}
      />,
    );
    expect(screen.getByText("On Sticky note: Launch checklist")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Add a comment"), "  Who owns this?  ");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(onAdd).toHaveBeenCalledWith("Who owns this?", "o1");
    expect(onClearTarget).toHaveBeenCalled();
    expect(screen.getByLabelText("Add a comment")).toHaveValue("");
  });

  it("keeps the text and shows the reason when posting fails", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("You're doing that too often. Wait a moment and try again."));
    const user = userEvent.setup();
    render(<CommentsPanel {...commentDefaults} comments={[]} canComment onAdd={onAdd} />);
    await user.type(screen.getByLabelText("Add a comment"), "Hello");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're doing that too often.");
    expect(screen.getByLabelText("Add a comment")).toHaveValue("Hello");
  });

  it("shows the author's real name and lets only the author edit or delete", () => {
    render(
      <CommentsPanel
        {...commentDefaults}
        canComment
        comments={[
          comment(),
          comment({
            id: "c2",
            author_id: "b",
            body: "Agreed",
            author: { first_name: "Ben", last_name: "Mensah", avatar_url: ben.avatar_url },
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Ada Okafor")).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: "Edit comment" })).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: "Delete comment" })).toBeInTheDocument();
    expect(within(items[1]).getByText("Ben Mensah")).toBeInTheDocument();
    expect(within(items[1]).queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(within(items[1]).queryByRole("button", { name: "Delete comment" })).toBeNull();
  });

  it("renders comment text as text, not markup", () => {
    const { container } = render(
      <CommentsPanel
        {...commentDefaults}
        canComment
        comments={[comment({ body: '<img src=x onerror="alert(1)"><b>bold</b>' })]}
      />,
    );
    expect(screen.getByText('<img src=x onerror="alert(1)"><b>bold</b>')).toBeInTheDocument();
    expect(container.querySelector("li img[src='x']")).toBeNull();
    expect(container.querySelector("li b")).toBeNull();
  });

  it("is read-only for viewers when commenting is disabled", () => {
    render(<CommentsPanel {...commentDefaults} comments={[comment()]} canComment={false} currentUserId="c" />);
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
    expect(screen.getByText("Viewers can read comments on this board but can’t add them.")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });

  it("edits a comment in place", async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CommentsPanel {...commentDefaults} canComment comments={[comment()]} onEdit={onEdit} />);
    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    const field = screen.getByLabelText("Edit comment");
    await user.clear(field);
    await user.type(field, "Looks great");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith("c1", "Looks great");
  });
});

describe("Activity panel", () => {
  const item: ActivityItem = {
    id: "1",
    type: "OBJECT_CREATED",
    actor_id: "b",
    object_id: null,
    metadata: { object_type: "STICKY_NOTE" },
    created_at: new Date().toISOString(),
    actor: { first_name: "Ben", last_name: "Mensah", avatar_url: ben.avatar_url },
    subject_name: null,
  };
  const defaults = { error: null, hasMore: false, loadingMore: false, onLoadMore: () => {}, onRetry: () => {} };

  it("shows an honest empty state", () => {
    render(<ActivityPanel {...defaults} items={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("lists events with the actor's name and a relative time", () => {
    render(<ActivityPanel {...defaults} items={[item]} />);
    const entry = screen.getByRole("listitem");
    expect(entry).toHaveTextContent("Ben Mensah added a sticky note");
    expect(entry.querySelector("time")).not.toBeNull();
  });

  it("offers older activity when there is more, and a retry when loading fails", async () => {
    const onLoadMore = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(<ActivityPanel {...defaults} items={[item]} hasMore onLoadMore={onLoadMore} />);
    await userEvent.click(screen.getByRole("button", { name: "Show older activity" }));
    expect(onLoadMore).toHaveBeenCalled();
    rerender(<ActivityPanel {...defaults} items={null} error="Foreman couldn't be reached." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Foreman couldn't be reached.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("Outline panel", () => {
  const defaults = {
    onSelect: () => {},
    onEditText: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
    onNudge: () => {},
  };
  const objects = [note("o1", "Define the goal"), { ...note("o2", ""), type: "ARROW" as const, props: {} }];

  it("lists every object with its type and text", () => {
    render(<OutlinePanel {...defaults} objects={objects} selectedId={null} canEdit />);
    const list = screen.getByRole("list", { name: "Board items" });
    expect(within(list).getByRole("button", { name: "Sticky note: Define the goal" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Arrow" })).toBeInTheDocument();
  });

  it("exposes edit, duplicate, delete and move for the selected item", async () => {
    const handlers = {
      onSelect: vi.fn(),
      onEditText: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onNudge: vi.fn(),
    };
    const user = userEvent.setup();
    render(<OutlinePanel {...handlers} objects={objects} selectedId="o1" canEdit />);
    const actions = screen.getByRole("group", { name: "Actions for Sticky note: Define the goal" });
    await user.click(within(actions).getByRole("button", { name: "Move right" }));
    expect(handlers.onNudge).toHaveBeenCalledWith("o1", 20, 0);
    await user.click(within(actions).getByRole("button", { name: "Move up" }));
    expect(handlers.onNudge).toHaveBeenCalledWith("o1", 0, -20);
    await user.click(within(actions).getByRole("button", { name: "Duplicate" }));
    expect(handlers.onDuplicate).toHaveBeenCalledWith("o1");

    await user.click(within(actions).getByRole("button", { name: "Edit text" }));
    const field = screen.getByRole("textbox", { name: "Text" });
    await user.clear(field);
    await user.type(field, "Agree the goal");
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(handlers.onEditText).toHaveBeenCalledWith("o1", "Agree the goal");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(handlers.onDelete).toHaveBeenCalledWith("o1");
  });

  it("offers no editing actions to a viewer", () => {
    render(<OutlinePanel {...defaults} objects={objects} selectedId="o1" canEdit={false} />);
    expect(screen.queryByRole("group", { name: /Actions for/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sticky note: Define the goal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("explains an empty board", () => {
    render(<OutlinePanel {...defaults} objects={[]} selectedId={null} canEdit />);
    expect(screen.getByText("This board is empty")).toBeInTheDocument();
  });
});
