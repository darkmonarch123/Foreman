import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Foreman Assistant in a real browser: preview, accept, realtime, per-proposal undo, stale detection,
 * viewer limits and offline behaviour, against the in-memory backend (see fake-backend.ts).
 */

const QUESTION = "Who owns the pricing page?";
const QUESTION_2 = "When do we announce the beta?";

type Control = (action: string, body?: Record<string, unknown>) => Promise<unknown>;

/** A board with one or two open questions, so each run has a predictable "Unanswered question" card. */
async function seed(control: Control, questions: string[] = [QUESTION]) {
  await control("reset", { template: false });
  for (const [index, text] of questions.entries()) {
    await control("add-object", { text, x: 120 + index * 360, y: 140 });
  }
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Foreman Assistant" });
const card = (page: Page, title = "Unanswered question") => panel(page).getByRole("listitem", { name: title }).first();
const assistantNotes = (state: { objects: { deleted: boolean; props: Record<string, unknown> }[] }) =>
  state.objects.filter((object) => !object.deleted && String(object.props.text ?? "").startsWith("Decide:"));

async function openAssistant(page: Page) {
  await page.keyboard.press("f");
  await expect(panel(page)).toBeVisible();
}

async function runGaps(page: Page) {
  await openAssistant(page);
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(card(page)).toBeVisible();
}

test.describe("opening the Assistant", () => {
  test("F opens it beside the canvas, which stays visible, and Escape closes it", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    await openAssistant(page);
    await expect(panel(page).getByRole("heading", { name: "Foreman Assistant" })).toBeFocused();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    const canvas = await page.getByTestId("canvas-stage").boundingBox();
    const side = await panel(page).boundingBox();
    expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(side!.x + 1); // beside it, not over it
    expect(canvas!.width).toBeGreaterThan(600);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test("F toggles from the keyboard, and the top bar button does the same", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    const button = page.getByRole("button", { name: "Foreman Assistant" });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(panel(page)).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("canvas-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("f");
    await expect(panel(page)).toBeHidden();
  });

  test("F does nothing while typing in a text field", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    await openAssistant(page);
    const guidance = panel(page).getByLabel("Guidance (optional)");
    await guidance.focus();
    await page.keyboard.type("fast food");
    await expect(guidance).toHaveValue("fast food");
    await expect(panel(page)).toBeVisible();
  });

  test("F does not open it while editing a note's text", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    const centre = await page.locator("[data-object-id]").first().boundingBox();
    await page.mouse.dblclick(centre!.x + centre!.width / 2, centre!.y + centre!.height / 2);
    const editor = page.getByRole("textbox", { name: "Text for sticky note" });
    await expect(editor).toBeFocused();
    await page.keyboard.type(" for Friday");
    await expect(editor).toHaveValue(`${QUESTION} for Friday`);
    await expect(panel(page)).toBeHidden();
  });

  test("the context menu offers the three actions and runs the one chosen", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    const box = await page.locator("[data-object-id]").first().boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "right" });
    const menu = page.getByRole("menu", { name: "Canvas actions" });
    for (const name of ["Explain this board", "Find planning gaps", "Propose a plan"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
    await menu.getByRole("menuitem", { name: "Find planning gaps" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(card(page)).toBeVisible();
  });

  test("a selected item can be looked at on its own", async ({ openBoard, control }) => {
    await seed(control, [QUESTION, QUESTION_2]);
    const page = await openBoard("ada");
    const box = await page.locator("[data-object-id]").filter({ hasText: QUESTION_2 }).boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await openAssistant(page);
    await panel(page).getByLabel("Look at").selectOption("object");
    await expect(panel(page).getByText(/^Selected: /)).toBeVisible();
    await panel(page).getByRole("button", { name: "Run" }).click();
    await expect(card(page)).toContainText(QUESTION_2);
    await expect(panel(page).getByText(QUESTION, { exact: false })).toHaveCount(0);
  });
});

test.describe("reviewing and accepting", () => {
  test("previewing draws a temporary ghost that is never saved, sent or added to history", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    const before = await serverState();

    await card(page).getByRole("button", { name: "Preview on board" }).click();
    await expect(page.getByTestId("assistant-ghost")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await serverState()).toMatchObject({ lastSequence: before.lastSequence, objects: before.objects });

    await card(page).getByRole("button", { name: "Hide preview" }).click();
    await expect(page.getByTestId("assistant-ghost")).toHaveCount(0);
  });

  test("the preview disappears when the panel closes", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: "Preview on board" }).click();
    await expect(page.getByTestId("assistant-ghost")).toBeVisible();
    await panel(page).getByRole("button", { name: "Close Assistant" }).click();
    await expect(page.getByTestId("assistant-ghost")).toHaveCount(0);
  });

  test("shows what would change, why, the evidence and the confidence, and has no Accept all", async ({
    openBoard,
    control,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    const c = card(page);
    await expect(c.getByText(/^(Fact|Inference|Suggestion)$/)).toBeVisible();
    await expect(c.getByText(/Confidence \d+%/)).toBeVisible();
    await expect(c.getByText("What would change")).toBeVisible();
    await expect(c.getByText("Evidence")).toBeVisible();
    await expect(c.getByText(QUESTION)).toBeVisible();
    await expect(page.getByRole("button", { name: /accept all/i })).toHaveCount(0);
  });

  test("View selects the evidence on the board", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: /^View/ }).click();
    await expect(page.getByTestId("selection-box")).toBeVisible();
  });

  test("accepting adds the note through the normal operation path, and another editor sees it live", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    await runGaps(ada);

    await card(ada).getByRole("button", { name: "Accept" }).click();
    await expect(card(ada).getByText("Added to the board")).toBeVisible();

    const state = await serverState();
    const added = assistantNotes(state);
    expect(added).toHaveLength(1);
    expect(state.log.at(-1)).toMatchObject({ type: "OBJECT_CREATED" });
    expect(state.activity).toContain("OBJECT_CREATED");

    await expect(ada.locator("[data-object-id]").filter({ hasText: "Decide:" })).toHaveCount(1);
    await expect(ben.locator("[data-object-id]").filter({ hasText: "Decide:" })).toHaveCount(1);
    await expect(ada.getByTestId("assistant-ghost")).toHaveCount(0);
    await expect(ada.getByRole("status").filter({ hasText: "accepted and added" })).toBeAttached();
  });

  test("an edited proposal applies the edited text", async ({ openBoard, control, serverState }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: "Edit" }).click();
    const field = page.getByLabel("Proposed text");
    await field.fill("Decide: pricing owner by Monday");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(card(page).getByTestId("proposal-text")).toHaveText("Decide: pricing owner by Monday");
    await expect(card(page).getByRole("button", { name: "Edit" })).toBeFocused();

    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState()).map((o) => o.props.text)).toEqual(["Decide: pricing owner by Monday"]);
  });

  test("rejecting removes the proposal and changes nothing on the board", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    const before = await serverState();
    await card(page).getByRole("button", { name: "Reject" }).click();
    await expect(panel(page).getByRole("listitem", { name: "Unanswered question" })).toHaveCount(0);
    expect(await serverState()).toMatchObject({ lastSequence: before.lastSequence });
    expect(assistantNotes(await serverState())).toHaveLength(0);
    expect((await control("assistant-events")) as string[]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^rejected /)]),
    );
  });

  test("a double click applies the proposal exactly once", async ({ openBoard, control, serverState }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: "Accept" }).dblclick();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState())).toHaveLength(1);
  });
});

test.describe("undo", () => {
  test("each accepted proposal is undone on its own, leaving the rest of the board alone", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control, [QUESTION, QUESTION_2]);
    const page = await openBoard("ada");
    await runGaps(page);
    const first = panel(page).getByRole("listitem", { name: "Unanswered question" }).filter({ hasText: QUESTION });
    const second = panel(page).getByRole("listitem", { name: "Unanswered question" }).filter({ hasText: QUESTION_2 });
    await first.getByRole("button", { name: "Accept" }).click();
    await expect(first.getByText("Added to the board")).toBeVisible();
    await second.getByRole("button", { name: "Accept" }).click();
    await expect(second.getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState())).toHaveLength(2);

    // Undo the older one first; the newer stays.
    await first.getByRole("button", { name: /Undo this/ }).click();
    await expect(first.getByText("Undone")).toBeVisible();
    await expect.poll(async () => assistantNotes(await serverState()).length).toBe(1);
    const state = await serverState();
    expect(state.objects.filter((o) => !o.deleted && o.props.text === QUESTION)).toHaveLength(1);
    expect(state.objects.filter((o) => !o.deleted && o.props.text === QUESTION_2)).toHaveLength(1);
    // Undo is a new operation; nothing was rewritten.
    expect(state.log.map((entry) => entry.type)).toEqual(
      expect.arrayContaining([
        "OBJECT_CREATED",
        "OBJECT_CREATED",
        "OBJECT_CREATED",
        "OBJECT_CREATED",
        "OBJECT_DELETED",
      ]),
    );
  });

  test("Ctrl+Z removes only the Assistant's note, and Ctrl+Shift+Z brings it back", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();

    await page.getByTestId("canvas-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => assistantNotes(await serverState()).length).toBe(0);
    expect((await serverState()).objects.filter((o) => !o.deleted && o.props.text === QUESTION)).toHaveLength(1);

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => assistantNotes(await serverState()).length).toBe(1);
  });
});

test.describe("stale proposals", () => {
  test("an edit by a collaborator marks the proposal stale and it cannot be accepted", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    const before = await serverState();

    await control("edit-object", { match: QUESTION, text: "Who owns the pricing page? Ben does." });

    await expect(card(page).getByText(/board changed since this was suggested/i)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Accept" })).toBeDisabled();
    const after = await serverState();
    expect(assistantNotes(after)).toHaveLength(0);
    expect(after.objects).toHaveLength(before.objects.length);
  });

  test("a deleted target marks it stale", async ({ openBoard, control, serverState }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await control("edit-object", { match: QUESTION, delete: true });
    await expect(card(page).getByText(/was deleted, so it can’t be applied/i)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(assistantNotes(await serverState())).toHaveLength(0);
  });

  test("the server refuses a stale proposal even when the browser missed the change", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await control("drop-operation-events", { drop: true });
    await control("edit-object", { match: QUESTION, text: "Changed while this browser was not listening" });
    await expect(card(page).getByRole("button", { name: "Accept" })).toBeEnabled(); // it has not noticed

    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("status").filter({ hasText: "out of date" })).toBeAttached();
    expect(assistantNotes(await serverState())).toHaveLength(0);
    await expect(ada(page)).toHaveCount(0);
  });
});

/** Assistant-made notes visible on this page. */
const ada = (page: Page) => page.locator("[data-object-id]").filter({ hasText: "Decide:" });

test.describe("permissions", () => {
  test("a viewer can run Find planning gaps but cannot accept, reject, edit or propose a plan", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("vic");
    await openAssistant(page);
    await expect(panel(page).getByRole("option", { name: "Propose a plan" })).toBeDisabled();
    await panel(page).getByRole("button", { name: "Run" }).click();
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("button", { name: "Preview on board" }).click();
    await expect(page.getByTestId("assistant-ghost")).toBeVisible();
    for (const name of ["Accept", "Reject", "Edit"]) {
      await expect(card(page).getByRole("button", { name })).toHaveCount(0);
    }
    expect(assistantNotes(await serverState())).toHaveLength(0);
  });

  test("a viewer can run Explain this board", async ({ openBoard, control }) => {
    await seed(control, [QUESTION, "Pricing options", "Launch plan"]);
    const page = await openBoard("vic");
    await openAssistant(page);
    await panel(page).getByLabel("What should it do?").selectOption("explain_board");
    await panel(page).getByRole("button", { name: "Run" }).click();
    await expect(panel(page).getByRole("listitem", { name: "Board overview" })).toBeVisible();
  });

  test("an editor can run Propose a plan", async ({ openBoard, control }) => {
    await seed(control, [QUESTION, "Pricing options", "Pricing tiers draft"]);
    const page = await openBoard("ben");
    await openAssistant(page);
    await panel(page).getByLabel("What should it do?").selectOption("propose_plan");
    await panel(page).getByRole("button", { name: "Run" }).click();
    await expect(panel(page).getByRole("listitem").first()).toBeVisible();
  });
});

test.describe("offline and reconnecting", () => {
  test("Accept is unavailable offline, nothing is silently applied, and it works once back online", async ({
    openBoard,
    control,
    serverState,
    context,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);

    await context.setOffline(true);
    await expect(card(page).getByText(/You’re offline/)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(assistantNotes(await serverState())).toHaveLength(0);

    await context.setOffline(false);
    await expect(card(page).getByRole("button", { name: "Accept" })).toBeEnabled();
    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState())).toHaveLength(1);
  });

  test("missing the realtime event for an accepted proposal never duplicates the note", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    const ben = await openBoard("ben");
    await runGaps(page);
    await control("drop-operation-events", { drop: true });
    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    await control("drop-operation-events", { drop: false });

    // Ben missed it; reloading catches up from the server and shows it exactly once.
    await ben.reload();
    await expect(ben.getByTestId("canvas-stage")).toBeVisible();
    await expect(ada(ben)).toHaveCount(1);
    await expect(ada(page)).toHaveCount(1);
    expect(assistantNotes(await serverState())).toHaveLength(1);
  });

  test("proposals come back after a reload and an applied one cannot be applied again", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await page.reload();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await openAssistant(page);
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState())).toHaveLength(1);
  });
});

test.describe("privacy and the feature flag", () => {
  test("a run makes no request to any host except the app's own backend", async ({ openBoard, control }) => {
    await seed(control);
    const page = await openBoard("ada");
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
    });
    await runGaps(page);
    await card(page).getByRole("button", { name: "Accept" }).click();
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    const allowed = new Set([
      "127.0.0.1:4317",
      `127.0.0.1:${(await page.evaluate(() => location.search)).match(/127\.0\.0\.1%3A(\d+)/)![1]}`,
    ]);
    expect([...hosts].filter((host) => !allowed.has(host))).toEqual([]);
  });

  test("with the flag off there is no Assistant button, shortcut, menu item or panel", async ({
    backend,
    page,
    control,
  }) => {
    await seed(control);
    await page.goto(`/?backend=${encodeURIComponent(`http://127.0.0.1:${backend.port}`)}&user=ada&assistant=off`);
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(page.getByRole("button", { name: "Foreman Assistant" })).toHaveCount(0);
    await page.getByTestId("canvas-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("f");
    await expect(panel(page)).toHaveCount(0);
    await page.mouse.click(600, 500, { button: "right" });
    await expect(page.getByRole("menuitem", { name: "Find planning gaps" })).toHaveCount(0);
  });
});

test.describe("accessibility", () => {
  test("is fully usable from the keyboard and announces its progress", async ({ openBoard, control, serverState }) => {
    await seed(control);
    const page = await openBoard("ada");
    await page.getByTestId("canvas-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("f");
    await expect(panel(page).getByRole("heading", { name: "Foreman Assistant" })).toBeFocused();

    await page.keyboard.press("Tab"); // close button
    await page.keyboard.press("Tab"); // action
    await page.keyboard.press("Tab"); // context
    await page.keyboard.press("Tab"); // guidance
    await page.keyboard.press("Tab"); // run
    await expect(panel(page).getByRole("button", { name: "Run" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Foreman Assistant finished" })).toBeAttached();

    await card(page).getByRole("button", { name: "Accept" }).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByText("Added to the board")).toBeVisible();
    expect(assistantNotes(await serverState())).toHaveLength(1);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });
});

test.describe("preview isolation", () => {
  const pendingQueue = (page: Page) =>
    page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("foreman:pending:"))
        .map((key) => localStorage.getItem(key)),
    );

  test("a preview is not broadcast to collaborators, not saved, and not undoable", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control);
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    const benObjects = await ben.locator("[data-object-id]").count();
    await runGaps(ada);
    const before = await serverState();

    await card(ada).getByRole("button", { name: "Preview on board" }).click();
    await expect(ada.getByTestId("assistant-ghost")).toBeVisible();
    // Give any broadcast time to arrive, then check Ben saw nothing.
    await ada.waitForTimeout(500);
    await expect(ben.getByTestId("assistant-ghost")).toHaveCount(0);
    await expect(ben.locator("[data-object-id]")).toHaveCount(benObjects);
    // The ghost is not a board object, even on Ada's own page.
    await expect(ada.locator("[data-object-id]")).toHaveCount(benObjects);
    expect(await serverState()).toMatchObject({ lastSequence: before.lastSequence, activity: before.activity });
    await expect(ada.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await pendingQueue(ada)).toEqual([]);
  });

  test("a preview made offline is not queued and nothing is sent on reconnect", async ({
    openBoard,
    control,
    serverState,
    context,
  }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    const before = await serverState();

    await context.setOffline(true);
    await card(page).getByRole("button", { name: "Preview on board" }).click();
    await expect(page.getByTestId("assistant-ghost")).toBeVisible();
    expect(await pendingQueue(page)).toEqual([]);
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);

    await context.setOffline(false);
    await page.waitForTimeout(800);
    const after = await serverState();
    expect(after.lastSequence).toBe(before.lastSequence);
    expect(assistantNotes(after)).toHaveLength(0);
  });

  test("refreshing the page removes the preview", async ({ openBoard, control, serverState }) => {
    await seed(control);
    const page = await openBoard("ada");
    await runGaps(page);
    await card(page).getByRole("button", { name: "Preview on board" }).click();
    await expect(page.getByTestId("assistant-ghost")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(page.getByTestId("assistant-ghost")).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    expect(assistantNotes(await serverState())).toHaveLength(0);
  });
});

test.describe("undo with collaborators", () => {
  test("undoing an accepted proposal does not revert a collaborator's later edit", async ({
    openBoard,
    control,
    serverState,
  }) => {
    await seed(control, [QUESTION, "Budget draft"]);
    const ada = await openBoard("ada");
    await runGaps(ada);
    await card(ada).getByRole("button", { name: "Accept" }).click();
    await expect(card(ada).getByText("Added to the board")).toBeVisible();

    // Ben edits another note afterwards.
    await control("edit-object", { match: "Budget draft", text: "Budget approved" });
    await expect(ada.getByText("Budget approved")).toBeVisible();

    await card(ada)
      .getByRole("button", { name: /Undo this/ })
      .click();
    await expect.poll(async () => assistantNotes(await serverState()).length).toBe(0);
    const state = await serverState();
    expect(state.objects.find((o) => o.props.text === "Budget approved")).toMatchObject({ deleted: false });
    expect(state.objects.filter((o) => !o.deleted && o.props.text === QUESTION)).toHaveLength(1);
    await expect(ada.getByText("Budget approved")).toBeVisible();
  });
});

test.describe("feature flag off", () => {
  test("no entry point opens a working panel, and the board still works", async ({
    backend,
    page,
    control,
    serverState,
  }) => {
    await seed(control);
    await page.goto(`/?backend=${encodeURIComponent(`http://127.0.0.1:${backend.port}`)}&user=ada&assistant=off`);
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();

    // Top bar, shortcut, command palette, context menu and the selected-object toolbar.
    await expect(page.getByRole("button", { name: "Foreman Assistant" })).toHaveCount(0);
    await page.getByTestId("canvas-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("f");
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Assistant");
    await expect(page.getByRole("option", { name: /Foreman Assistant/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const box = await page.locator("[data-object-id]").first().boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(
      page.getByRole("toolbar", { name: "Board tools" }).getByRole("group", { name: "Style" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask Foreman about this item" })).toHaveCount(0);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "right" });
    for (const name of ["Explain this board", "Find planning gaps", "Propose a plan"]) {
      await expect(page.getByRole("menuitem", { name })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");

    // Ordinary editing is unchanged.
    const canvas = await page.getByTestId("canvas-stage").boundingBox();
    await page.keyboard.press("n");
    await page.mouse.click(canvas!.x + 700, canvas!.y + 600);
    const editor = page.getByRole("textbox", { name: "Text for sticky note" });
    await editor.fill("Still works with the flag off");
    await editor.press("Control+Enter");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const state = await serverState();
    expect(state.objects.some((o) => o.props.text === "Still works with the flag off")).toBe(true);
    expect((await control("assistant-events")) as string[]).toEqual([]);
  });
});

test.describe("arriving from What's new", () => {
  test("?assistant=open opens the panel on arrival, then drops the parameter so a reload doesn't reopen it", async ({
    backend,
    page,
    control,
  }) => {
    await seed(control);
    await page.goto(`/?backend=${encodeURIComponent(`http://127.0.0.1:${backend.port}`)}&user=ada&assistant=open`);
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: "Foreman Assistant" })).toBeFocused();
    await expect.poll(() => new URL(page.url()).searchParams.get("assistant")).toBeNull();

    await page.reload();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });

  test("?assistant=open does nothing when the Assistant is off", async ({ backend, page, control }) => {
    await seed(control);
    // assistant=off simulates the flag; a second assistant parameter cannot switch it back on.
    await page.goto(
      `/?backend=${encodeURIComponent(`http://127.0.0.1:${backend.port}`)}&user=ada&assistant=off&assistant=open`,
    );
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});
