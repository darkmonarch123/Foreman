// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel, type AssistantIntent } from "@/components/board/assistant-panel";
import type { AssistantServices, ProposalDraft } from "@/lib/assistant/types";
import type { BoardRole, CanvasObject } from "@/lib/board/types";
import { AppError } from "@/lib/errors";
import { arrow, note, resetFixtureIds } from "../support/assistant-fixtures";
import { FakeBoardServer } from "../support/fake-board-server";
import { MemoryAssistant } from "../support/memory-assistant";

const ME = "user-me";

interface Setup {
  board: FakeBoardServer;
  memory: MemoryAssistant;
  callbacks: ReturnType<typeof makeCallbacks>;
}

function makeCallbacks() {
  return {
    onClose: vi.fn(),
    onPreview: vi.fn<(draft: ProposalDraft | null) => void>(),
    onFocusObject: vi.fn(),
    onApplied: vi.fn(),
    onUndoApplied: vi.fn(() => true),
    onAnnounce: vi.fn(),
  };
}

function seed(board: FakeBoardServer, ...objects: CanvasObject[]) {
  for (const object of objects) board.objects.set(object.id, object);
}

function setup(role: BoardRole = "OWNER", objects: CanvasObject[] = []): Setup {
  const board = new FakeBoardServer();
  seed(board, ...objects);
  const memory = new MemoryAssistant(board, () => role);
  return { board, memory, callbacks: makeCallbacks() };
}

function panel(
  s: Setup,
  options: {
    canEdit?: boolean;
    online?: boolean;
    services?: AssistantServices;
    selected?: { id: string; label: string } | null;
    intent?: AssistantIntent | null;
  } = {},
) {
  return (
    <AssistantPanel
      services={options.services ?? s.memory.servicesFor(ME)}
      canEdit={options.canEdit ?? true}
      online={options.online ?? true}
      objectsById={new Map(s.board.objects)}
      selected={options.selected ?? null}
      intent={options.intent ?? null}
      {...s.callbacks}
    />
  );
}

/** Every note with no arrow also yields a "not connected" finding, so tests pick the card they mean. */
const gap = () => screen.getByRole("listitem", { name: "Unanswered question" });
const gapReady = () => screen.findByRole("listitem", { name: "Unanswered question" });

async function runGaps(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Run" }));
}

beforeEach(() => resetFixtureIds());

describe("Assistant panel", () => {
  it("is a labelled region with the three actions and both contexts", async () => {
    const s = setup();
    render(panel(s));
    expect(await screen.findByRole("complementary", { name: "Foreman Assistant" })).toBeInTheDocument();
    const action = screen.getByLabelText("What should it do?");
    expect(
      within(action)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Explain this board", "Find planning gaps", "Propose a plan"]);
    const context = screen.getByLabelText("Look at");
    expect(within(context).getByRole("option", { name: "Entire board" })).toBeEnabled();
    expect(within(context).getByRole("option", { name: "Selected object" })).toBeDisabled();
  });

  it("moves focus into the panel and says it never changes anything until you accept", async () => {
    const s = setup();
    render(panel(s));
    await screen.findByRole("complementary");
    expect(screen.getByRole("heading", { name: "Foreman Assistant" })).toHaveFocus();
    expect(screen.getByText(/Nothing changes until you accept/)).toBeInTheDocument();
  });

  it("shows the empty state when nothing qualifies", async () => {
    const user = userEvent.setup();
    const left = note("The beta checklist was completed and reviewed by the whole team", 0, 0);
    const right = note("Customer interviews finished with consistent positive feedback", 400, 0);
    const s = setup("OWNER", [left, right, arrow(180, 70, 400, 70)]);
    render(panel(s));
    await runGaps(user);
    expect(await screen.findByText("No high-confidence planning gaps found.")).toBeInTheDocument();
  });

  it("shows a finding with its label, confidence, explanation, evidence and what would change", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?", 0, 0);
    const s = setup("OWNER", [question]);
    render(panel(s));
    await runGaps(user);

    const card = await screen.findByRole("listitem", { name: /question/i });
    expect(within(card).getByText(/^(Fact|Inference|Suggestion)$/)).toBeInTheDocument();
    expect(within(card).getByText(/Confidence \d+%/)).toBeInTheDocument();
    expect(within(card).getByText("Evidence")).toBeInTheDocument();
    expect(within(card).getByText(/Who owns the pricing page\?/)).toBeInTheDocument();
    expect(within(card).getByText("What would change")).toBeInTheDocument();
    expect(within(card).getByTestId("proposal-text")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept all/i })).not.toBeInTheDocument();
  });

  it("View moves to the evidence object", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?", 0, 0);
    const s = setup("OWNER", [question]);
    render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: /^View/ }));
    expect(s.callbacks.onFocusObject).toHaveBeenCalledWith(question.id);
  });

  it("previews on the board and hides the preview again, without applying anything", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    const toggle = await within(await gapReady()).findByRole("button", { name: "Preview on board" });
    await user.click(toggle);
    expect(s.callbacks.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "create_object" }));
    expect(within(gap()).getByRole("button", { name: "Hide preview" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(gap()).getByRole("button", { name: "Hide preview" }));
    expect(s.callbacks.onPreview).toHaveBeenLastCalledWith(null);
    expect(s.board.objects.size).toBe(1);
    expect(s.board.log).toHaveLength(0);
  });

  it("accepts a proposal through the service, adds the note, and offers per-proposal undo", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Accept" }));

    await within(await gapReady()).findByText("Added to the board");
    expect(s.callbacks.onApplied).toHaveBeenCalledTimes(1);
    expect(s.board.objects.size).toBe(2);
    expect(s.callbacks.onAnnounce).toHaveBeenCalledWith(expect.stringMatching(/accepted and added/i));

    const created = s.callbacks.onApplied.mock.calls[0][0];
    await user.click(within(gap()).getByRole("button", { name: /Undo this/ }));
    expect(s.callbacks.onUndoApplied).toHaveBeenCalledWith(created.object_id);
    expect(await within(gap()).findByText("Undone")).toBeInTheDocument();
  });

  it("rejects a proposal and removes it without touching the board", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Unanswered question" })).not.toBeInTheDocument(),
    );
    expect(s.board.objects.size).toBe(1);
    expect(s.memory.events.some((event) => event.startsWith("rejected "))).toBe(true);
  });

  it("edits the proposed text, and the edited text is what gets applied", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Proposed text");
    await user.clear(field);
    await user.type(field, "Decide: pricing owner by Monday");
    await user.click(within(gap()).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(within(gap()).getByTestId("proposal-text")).toHaveTextContent("Decide: pricing owner by Monday"),
    );

    await user.click(within(gap()).getByRole("button", { name: "Accept" }));
    await within(await gapReady()).findByText("Added to the board");
    const created = [...s.board.objects.values()].find((object) => object.id.startsWith("00000000-0000-4000-a001"));
    expect(created?.props.text).toBe("Decide: pricing owner by Monday");
    expect([...s.memory.proposals.values()].filter((p) => p.status === "edited_accepted")).toHaveLength(1);
  });

  it("limits edited text to 200 characters", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Proposed text");
    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(201));
    expect(await screen.findByText(/under 200 characters/)).toBeInTheDocument();
    expect(within(gap()).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a viewer findings but no way to edit, reject or accept, and no Propose a plan", async () => {
    const user = userEvent.setup();
    const s = setup("VIEWER", [note("Who owns the pricing page?")]);
    render(panel(s, { canEdit: false }));
    expect(screen.getByRole("option", { name: "Propose a plan" })).toBeDisabled();
    await runGaps(user);
    await within(await gapReady()).findByRole("button", { name: "Preview on board" });
    for (const name of ["Accept", "Reject", "Edit"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
    expect(within(gap()).getByText(/you can read and preview this, but not accept it/i)).toBeInTheDocument();
  });

  it("lets a viewer run Explain this board", async () => {
    const user = userEvent.setup();
    const s = setup("VIEWER", [note("Pricing question?"), note("Billing notes"), note("Launch plan")]);
    render(panel(s, { canEdit: false }));
    await user.selectOptions(screen.getByLabelText("What should it do?"), "explain_board");
    await runGaps(user);
    expect(await screen.findByRole("listitem", { name: "Board overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("marks a proposal stale when its evidence changed, and disables Accept", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?");
    const s = setup("OWNER", [question]);
    const view = render(panel(s));
    await runGaps(user);
    await within(await gapReady()).findByRole("button", { name: "Accept" });

    s.board.objects.set(question.id, { ...question, version: question.version + 1 });
    view.rerender(panel(s));

    expect(await within(await gapReady()).findByText(/board changed since this was suggested/i)).toBeInTheDocument();
    expect(within(gap()).getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("says so when evidence was deleted", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?");
    const s = setup("OWNER", [question]);
    const view = render(panel(s));
    await runGaps(user);
    await within(await gapReady()).findByRole("button", { name: "Accept" });
    s.board.objects.set(question.id, { ...question, deleted: true });
    view.rerender(panel(s));
    expect(await within(await gapReady()).findByText(/was deleted, so it can’t be applied/i)).toBeInTheDocument();
    expect(within(gap()).getByRole("button", { name: /^View/ })).toBeDisabled();
  });

  it("never applies a proposal the server reports as stale, even if the browser did not notice", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?");
    const s = setup("OWNER", [question]);
    render(panel(s)); // the panel's own copy of the board never updates
    await runGaps(user);
    const button = await within(await gapReady()).findByRole("button", { name: "Accept" });

    s.board.objects.set(question.id, { ...question, version: 5 }); // someone else edited it
    await user.click(button);

    await waitFor(() => expect(s.callbacks.onAnnounce).toHaveBeenCalledWith(expect.stringMatching(/out of date/i)));
    expect(s.callbacks.onApplied).not.toHaveBeenCalled();
    expect(s.board.objects.size).toBe(1);
    expect(s.board.log).toHaveLength(0);
  });

  it("disables Accept while offline and explains why", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s, { online: false }));
    await runGaps(user);
    expect(await within(await gapReady()).findByRole("button", { name: "Accept" })).toBeDisabled();
    expect(within(gap()).getByText(/You’re offline/)).toBeInTheDocument();
  });

  it("shows a failed apply as a clear message and leaves the board alone", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    const services = s.memory.servicesFor(ME);
    render(
      panel(s, {
        services: {
          ...services,
          accept: async (id) => ({ status: "failed", code: "RATE_LIMITED", proposal: s.memory.proposals.get(id)! }),
        },
      }),
    );
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Accept" }));
    expect(await within(await gapReady()).findByText(/accepting too quickly/i)).toBeInTheDocument();
    expect(s.callbacks.onApplied).not.toHaveBeenCalled();
  });

  it("explains permission loss on accept", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    const services = s.memory.servicesFor(ME);
    render(
      panel(s, {
        services: {
          ...services,
          accept: async () => {
            throw new AppError("BOARD_ACCESS_DENIED");
          },
        },
      }),
    );
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Accept" }));
    expect(await within(await gapReady()).findByText(/no longer have permission/i)).toBeInTheDocument();
  });

  it("shows analysis errors in an alert, including rate limiting", async () => {
    const user = userEvent.setup();
    const s = setup();
    const services = s.memory.servicesFor(ME);
    render(
      panel(s, {
        services: {
          ...services,
          run: async () => {
            throw new AppError("RATE_LIMITED");
          },
        },
      }),
    );
    await runGaps(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/too often/i);
  });

  it("only enables Selected object when an item is selected, and sends that object", async () => {
    const user = userEvent.setup();
    const question = note("Who owns the pricing page?");
    const s = setup("OWNER", [question]);
    const run = vi.fn(s.memory.servicesFor(ME).run);
    render(
      panel(s, { services: { ...s.memory.servicesFor(ME), run }, selected: { id: question.id, label: "Sticky note" } }),
    );
    await user.selectOptions(screen.getByLabelText("Look at"), "object");
    expect(screen.getByText("Selected: Sticky note")).toBeInTheDocument();
    await runGaps(user);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ context: { kind: "object", objectId: question.id } }));
  });

  it("passes optional guidance along and reports what it left out", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?"), note("Billing: who pays?", 400, 0)]);
    const run = vi.fn(s.memory.servicesFor(ME).run);
    render(panel(s, { services: { ...s.memory.servicesFor(ME), run } }));
    await user.type(screen.getByLabelText("Guidance (optional)"), "do not include billing");
    await runGaps(user);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ guidance: "do not include billing" }));
    expect(await screen.findByText(/Leaving out: billing/)).toBeInTheDocument();
    expect(screen.queryByText(/Billing: who pays/)).not.toBeInTheDocument();
  });

  it("renders note text as text, never as markup", async () => {
    const user = userEvent.setup();
    const hostile = note('Who owns <img src=x onerror="window.__pwned=1"> this?');
    const s = setup("OWNER", [hostile]);
    const { container } = render(panel(s));
    await runGaps(user);
    await screen.findAllByText("Evidence");
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("runs a requested action once, from an outside request", async () => {
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    const run = vi.fn(s.memory.servicesFor(ME).run);
    const services = { ...s.memory.servicesFor(ME), run };
    const intent: AssistantIntent = { nonce: 1, action: "find_planning_gaps", context: "board" };
    const view = render(panel(s, { services, intent }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    view.rerender(panel(s, { services, intent })); // same nonce: not run again
    expect(run).toHaveBeenCalledTimes(1);
    view.rerender(panel(s, { services, intent: { ...intent, nonce: 2 } }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it("announces progress and the result through the live region callback", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    render(panel(s));
    await runGaps(user);
    await within(await gapReady()).findByRole("button", { name: "Accept" });
    expect(s.callbacks.onAnnounce).toHaveBeenCalledWith(expect.stringMatching(/running/));
    expect(s.callbacks.onAnnounce).toHaveBeenCalledWith(expect.stringMatching(/finished\. \d+ finding/));
  });

  it("closes on Escape, cancelling an edit first, and clears the preview when unmounted", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns the pricing page?")]);
    const view = render(panel(s));
    await runGaps(user);
    await user.click(await within(await gapReady()).findByRole("button", { name: "Edit" }));
    await user.keyboard("{Escape}");
    expect(s.callbacks.onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Proposed text")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(s.callbacks.onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(s.callbacks.onPreview).toHaveBeenLastCalledWith(null);
  });

  it("returns focus to whatever opened it", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const s = setup();
    const view = render(panel(s));
    await screen.findByRole("complementary");
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

describe("Assistant v1.1: ranking, bands and feedback", () => {
  const manyNotes = () =>
    [
      "Who owns onboarding?",
      "Why churn is rising",
      "TBD",
      "Fix the billing bug",
      "Who decides pricing?",
      "misc",
      "Ship v2",
    ].map((text, index) => note(text, (index % 4) * 600, Math.floor(index / 4) * 600));

  it("shows the five most useful findings first, then the rest on request", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", manyNotes());
    render(panel(s));
    await runGaps(user);
    const more = await screen.findByRole("button", { name: /Show more findings/ });
    const cards = () =>
      screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-labelledby")?.startsWith("finding-"));
    expect(cards()).toHaveLength(5);
    await user.click(more);
    expect(screen.queryByRole("button", { name: /Show more findings/ })).toBeNull();
    expect(cards().length).toBeGreaterThan(5);
  });

  it("labels each finding Clear, Likely or Possible with a short explanation", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns onboarding?")]);
    render(panel(s));
    await runGaps(user);
    const card = await gapReady();
    expect(within(card).getByText(/^(Clear|Likely|Possible)$/)).toBeInTheDocument();
    expect(within(card).getByText(/^(Clear|Likely|Possible): /)).toBeInTheDocument();
  });

  it("records Not helpful with reasons, hides the type, and can remove the feedback", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns onboarding?")]);
    render(panel(s));
    await runGaps(user);
    const card = await gapReady();
    await user.click(within(card).getByRole("button", { name: "Not helpful" }));
    expect(within(card).getByRole("button", { name: "Not helpful" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(card).getByRole("button", { name: "Duplicate" }));
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "Duplicate" })).toHaveAttribute("aria-pressed", "true"),
    );
    const [proposalId] = [...s.memory.feedback.keys()];
    expect(s.memory.feedback.get(proposalId)).toEqual({ helpful: false, reasons: ["duplicate"] });

    await user.click(within(card).getByRole("button", { name: "Hide this type of finding on this board" }));
    await waitFor(() => expect(s.memory.hidden.get(ME)?.size).toBe(1));

    await user.click(within(card).getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(s.memory.feedback.size).toBe(0));
    expect(s.memory.events).toEqual(expect.arrayContaining([`feedback_removed ${proposalId}`]));
  });

  it("goes back if saving feedback fails", async () => {
    const user = userEvent.setup();
    const s = setup("OWNER", [note("Who owns onboarding?")]);
    const services = s.memory.servicesFor(ME);
    services.setFeedback = vi.fn(async () => {
      throw new AppError("NETWORK");
    });
    render(panel(s, { services }));
    await runGaps(user);
    const card = await gapReady();
    await user.click(within(card).getByRole("button", { name: "Helpful" }));
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "false"),
    );
  });
});
