import { readFileSync } from "node:fs";
import { canvasBox, doubleClickObject, expect, objectCentre, test } from "./fixtures";

/**
 * The real board UI and sync engine in a real browser, with several users
 * connected to one in-memory test backend. See fake-backend.ts for what the
 * backend does and does not stand in for.
 */

const notes = (page: import("@playwright/test").Page) => page.locator('[data-object-type="STICKY_NOTE"]');

test.describe("editing", () => {
  test("adds a sticky note with the N shortcut and saves it", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const before = await notes(page).count();
    const canvas = await canvasBox(page);

    await page.keyboard.press("n");
    await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.mouse.click(canvas.x + 500, canvas.y + 620);

    // The note opens for typing straight away.
    const editor = page.getByRole("textbox", { name: "Text for sticky note" });
    await expect(editor).toBeFocused();
    await editor.fill("Draft the launch checklist");
    await editor.press("Control+Enter");

    await expect(notes(page)).toHaveCount(before + 1);
    await expect(page.getByText("Draft the launch checklist")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    const state = await serverState();
    const saved = state.objects.find((object) => object.props.text === "Draft the launch checklist");
    expect(saved).toMatchObject({ type: "STICKY_NOTE", deleted: false });
    expect(state.log.map((entry) => entry.type)).toEqual(["OBJECT_CREATED", "OBJECT_UPDATED"]);
  });

  test("drags a sticky note into the Build column and persists the new position", async ({
    openBoard,
    serverState,
  }) => {
    const page = await openBoard("ada");
    const from = await objectCentre(page, "Example: list milestones");
    const build = await objectCentre(page, "Example: first deliverable");
    const target = { x: build.x, y: build.y + 130 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + target.x) / 2, (from.y + target.y) / 2, { steps: 5 });
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const state = await serverState();
    const moved = state.objects.find((object) => object.props.text === "Example: list milestones")!;
    // The Build column spans x 340..640 in board coordinates.
    expect(moved.x).toBeGreaterThan(340);
    expect(moved.x + moved.width).toBeLessThan(640);
    expect(moved.version).toBe(2);
    expect(state.log.at(-1)?.type).toBe("OBJECT_MOVED");

    // Reload: the note is still in Build.
    await page.reload();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    const after = await objectCentre(page, "Example: list milestones");
    const buildAfter = await objectCentre(page, "Example: first deliverable");
    expect(Math.abs(after.x - buildAfter.x)).toBeLessThan(20);
  });

  test("resizes, restyles and deletes the selected object", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const centre = await objectCentre(page, "Example: define the goal");
    await page.mouse.click(centre.x, centre.y);
    await expect(page.getByTestId("selection-box")).toBeVisible();

    await page.getByRole("button", { name: "Fill: Coral" }).click();
    await expect
      .poll(
        async () => (await serverState()).objects.find((o) => o.props.text === "Example: define the goal")?.props.fill,
      )
      .toBe("#F3A5A0");

    const handle = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(handle!.x + 4, handle!.y + 4);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 64, handle!.y + 44, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await serverState()).objects.find((o) => o.props.text === "Example: define the goal")?.height)
      .toBeGreaterThan(120);

    await page.keyboard.press("Delete");
    await expect(page.getByText("Example: define the goal")).toHaveCount(0);
    await expect
      .poll(async () => (await serverState()).objects.find((o) => o.props.text === "Example: define the goal")?.deleted)
      .toBe(true);
  });

  test("undoes and redoes with the keyboard", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const centre = await objectCentre(page, "Example: review and feedback");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press("Delete");
    await expect(page.getByText("Example: review and feedback")).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(page.getByText("Example: review and feedback")).toBeVisible();
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByText("Example: review and feedback")).toHaveCount(0);

    await expect
      .poll(async () => (await serverState()).log.map((entry) => entry.type))
      .toEqual(["OBJECT_DELETED", "OBJECT_RESTORED", "OBJECT_DELETED"]);
  });

  test("draws shapes, arrows and freehand strokes", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const canvas = await canvasBox(page);
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(canvas.x + x1, canvas.y + y1);
      await page.mouse.down();
      await page.mouse.move(canvas.x + (x1 + x2) / 2, canvas.y + (y1 + y2) / 2, { steps: 4 });
      await page.mouse.move(canvas.x + x2, canvas.y + y2, { steps: 4 });
      await page.mouse.up();
    };

    await page.keyboard.press("r");
    await drag(420, 600, 560, 700);
    await page.keyboard.press("Escape");
    await page.keyboard.press("o");
    await drag(600, 600, 700, 700);
    await page.keyboard.press("Escape");
    await page.keyboard.press("a");
    await drag(740, 620, 860, 690);
    await page.keyboard.press("Escape");
    await page.keyboard.press("p");
    await drag(120, 780, 300, 800);
    await page.keyboard.press("v");

    await expect.poll(async () => (await serverState()).log.length).toBe(4);
    const types = (await serverState()).objects.map((object) => object.type);
    for (const type of ["RECTANGLE", "CIRCLE", "ARROW", "DRAWING"]) expect(types).toContain(type);
    const drawing = (await serverState()).objects.find((object) => object.type === "DRAWING")!;
    expect((drawing.props.points as number[]).length).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("ignores canvas shortcuts while typing", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.getByRole("tab", { name: "Comments" }).click();
    const box = page.getByLabel("Add a comment");
    await box.fill("");
    await box.pressSequentially("nvh? notes");
    await expect(box).toHaveValue("nvh? notes");
    // Still on the Select tool, and no dialog opened.
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("zooms and pans without changing the board", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const zoom = page.getByRole("button", { name: /Zoom \d+ percent/ });
    const start = await zoom.textContent();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).not.toHaveText(start!);
    await page.getByRole("button", { name: "Zoom to fit" }).click();
    await expect(zoom).toHaveText(start!);

    const before = await objectCentre(page, "Example: define the goal");
    const canvas = await canvasBox(page);
    await page.keyboard.press("h");
    await page.mouse.move(canvas.x + 700, canvas.y + 700);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 600, canvas.y + 640, { steps: 4 });
    await page.mouse.up();
    const after = await objectCentre(page, "Example: define the goal");
    expect(Math.round(after.x - before.x)).toBe(-100);
    expect(Math.round(after.y - before.y)).toBe(-60);
    expect((await serverState()).lastSequence).toBe(0);
  });
});

test.describe("collaboration", () => {
  test("shows a second user's presence only while they are connected", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    await expect(ada.getByText("No one else is on the board right now.")).toBeVisible();
    const online = ada.getByRole("region", { name: "Online now" });
    await expect(online.getByText("Ben Mensah")).toHaveCount(0);

    const ben = await openBoard("ben");
    await expect(online.getByText("Ben Mensah")).toBeVisible();
    await expect(ada.getByText("No one else is on the board right now.")).toHaveCount(0);
    await expect(ada.getByRole("button", { name: /2 people online/ })).toBeVisible();
    await expect(ada.getByRole("status").filter({ hasText: "Ben Mensah joined the board" })).toHaveCount(1);

    await ben.close();
    await expect(online.getByText("Ben Mensah")).toHaveCount(0);
    await expect(ada.getByRole("region", { name: "Offline" }).getByText("Ben Mensah")).toBeVisible();
  });

  test("shows the other user's cursor with their name, and removes it when they leave", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    await expect(ada.getByTestId("remote-cursor")).toHaveCount(0);

    const canvas = await canvasBox(ben);
    await ben.mouse.move(canvas.x + 400, canvas.y + 400);
    await ben.mouse.move(canvas.x + 460, canvas.y + 430, { steps: 6 });

    const cursor = ada.getByTestId("remote-cursor");
    await expect(cursor).toHaveCount(1);
    await expect(cursor).toContainText("Ben");
    // Ben does not see a remote cursor for himself.
    await expect(ben.getByTestId("remote-cursor")).toHaveCount(0);

    await ben.close();
    await expect(cursor).toHaveCount(0);
  });

  test("delivers one user's edits to the other in real time", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    const canvas = await canvasBox(ben);

    await ben.keyboard.press("n");
    await ben.mouse.click(canvas.x + 520, canvas.y + 640);
    const editor = ben.getByRole("textbox", { name: "Text for sticky note" });
    await editor.fill("Ben was here");
    await editor.press("Control+Enter");

    await expect(ada.getByText("Ben was here")).toBeVisible();

    // And back the other way: Ada edits Ben's note.
    await doubleClickObject(ada, "Ben was here");
    const adaEditor = ada.getByRole("textbox", { name: "Text for sticky note" });
    await adaEditor.fill("Ada edited this");
    await adaEditor.press("Control+Enter");
    await expect(ben.getByText("Ada edited this")).toBeVisible();
    await expect(ben.getByText("Ben was here")).toHaveCount(0);
  });

  test("posts a comment that the other user sees, with a matching activity entry", async ({
    openBoard,
    serverState,
  }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");

    await ben.getByRole("tab", { name: "Comments" }).click();
    await expect(ben.getByText("No comments yet")).toBeVisible();

    await ada.getByRole("tab", { name: "Comments" }).click();
    await ada.getByLabel("Add a comment").fill("Can we ship this on Friday?");
    await ada.getByRole("button", { name: "Post comment" }).click();

    const adaList = ada.getByRole("list", { name: "Comments, newest first" });
    await expect(adaList.getByText("Can we ship this on Friday?")).toBeVisible();
    await expect(adaList.getByText("Ada Okafor")).toBeVisible();
    await expect(adaList.getByRole("listitem")).toHaveCount(1);

    const benList = ben.getByRole("list", { name: "Comments, newest first" });
    await expect(benList.getByText("Can we ship this on Friday?")).toBeVisible();
    await expect(benList.getByText("Ada Okafor")).toBeVisible();
    // Only the author can edit or delete.
    await expect(ben.getByRole("button", { name: "Delete comment" })).toHaveCount(0);
    await expect(ada.getByRole("button", { name: "Delete comment" })).toHaveCount(1);

    await ben.getByRole("tab", { name: "Activity" }).click();
    await expect(
      ben.getByRole("list", { name: "Board activity, newest first" }).getByRole("listitem").first(),
    ).toContainText("Ada Okafor commented");
    expect((await serverState()).comments).toEqual(["Can we ship this on Friday?"]);
  });

  test("rejects an empty comment and anchors a comment to an object", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.getByRole("tab", { name: "Comments" }).click();
    await page.getByLabel("Add a comment").fill("   ");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Write a comment first." })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const centre = await objectCentre(page, "Example: first deliverable");
    await page.mouse.click(centre.x, centre.y);
    await expect(page.getByText("On Sticky note: Example: first deliverable")).toBeVisible();
    await page.getByLabel("Add a comment").fill("Who owns this?");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(
      page
        .getByRole("list", { name: "Comments, newest first" })
        .getByRole("button", { name: "On Sticky note: Example: first deliverable" }),
    ).toBeVisible();
  });

  test("renders hostile text as text, never as markup", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    let dialogs = 0;
    for (const page of [ada, ben])
      page.on("dialog", (dialog) => {
        dialogs += 1;
        void dialog.dismiss();
      });
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

    await ada.getByRole("tab", { name: "Comments" }).click();
    await ada.getByLabel("Add a comment").fill(payload);
    await ada.getByRole("button", { name: "Post comment" }).click();

    const canvas = await canvasBox(ada);
    await ada.keyboard.press("Escape");
    await ada.keyboard.press("n");
    await ada.mouse.click(canvas.x + 520, canvas.y + 660);
    const editor = ada.getByRole("textbox", { name: "Text for sticky note" });
    await editor.fill(payload);
    await editor.press("Control+Enter");

    await ben.getByRole("tab", { name: "Comments" }).click();
    await expect(ben.getByRole("list", { name: "Comments, newest first" }).getByText(payload)).toBeVisible();
    await expect(ben.locator("[data-object-id]").filter({ hasText: payload })).toBeVisible();
    for (const page of [ada, ben]) {
      expect(await page.locator("img[src='x']").count()).toBe(0);
      expect(await page.locator("[data-object-id] script, li script").count()).toBe(0);
    }
    expect(dialogs).toBe(0);
  });
});

test.describe("roles", () => {
  test("gives a viewer a read-only board", async ({ openBoard, serverState }) => {
    const page = await openBoard("vic");
    await expect(page.getByRole("status").filter({ hasText: "View only" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const canvas = await canvasBox(page);
    await page.keyboard.press("n");
    await page.mouse.click(canvas.x + 500, canvas.y + 640);
    await expect(page.getByRole("textbox", { name: "Text for sticky note" })).toHaveCount(0);

    // Dragging and deleting do nothing.
    const before = await objectCentre(page, "Example: define the goal");
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("Delete");
    await doubleClickObject(page, "Example: define the goal");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    const after = await objectCentre(page, "Example: define the goal");
    expect(after).toEqual(before);
    expect((await serverState()).lastSequence).toBe(0);

    // Comments are read-only for viewers by default.
    await page.getByRole("tab", { name: "Comments" }).click();
    await expect(page.getByText("Viewers can read comments on this board but can’t add them.")).toBeVisible();
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
  });

  test("still shows a viewer other people's live edits", async ({ openBoard }) => {
    const vic = await openBoard("vic");
    const ada = await openBoard("ada");
    const centre = await objectCentre(ada, "Example: review and feedback");
    await ada.mouse.click(centre.x, centre.y);
    await ada.keyboard.press("Delete");
    await expect(vic.getByText("Example: review and feedback")).toHaveCount(0);
  });

  test("lets the owner rename the board, and others see the new name", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    await expect(ben.getByRole("heading", { name: "Foreman Launch Plan" })).toBeVisible();
    await expect(ben.getByRole("button", { name: /Board name/ })).toHaveCount(0);

    await ada.getByRole("button", { name: "Board name: Foreman Launch Plan" }).click();
    const input = ada.getByLabel("Board name");
    await input.fill("Launch Plan v2");
    await input.press("Enter");
    await expect(ada.getByRole("button", { name: "Board name: Launch Plan v2" })).toBeVisible();
    await expect(ben.getByRole("heading", { name: "Launch Plan v2" })).toBeVisible();
  });

  test("tells a member when they are removed from the board", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    await ada.getByRole("button", { name: "Share" }).click();
    const dialog = ada.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Members" }).click();
    await dialog.getByRole("button", { name: "Remove Ben Mensah" }).click();
    await ada
      .getByRole("dialog", { name: "Remove Ben Mensah?" })
      .getByRole("button", { name: "Remove member" })
      .click();

    await expect(ben.getByRole("heading", { name: "You no longer have access to this board" })).toBeVisible();
    await expect(ben.getByTestId("canvas-stage")).toHaveCount(0);
  });
});

test.describe("offline and recovery", () => {
  test("queues edits while offline and saves them on reconnect", async ({ openBoard, serverState, context }) => {
    const page = await openBoard("ada");
    await context.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "Offline" }).first()).toBeVisible();

    const canvas = await canvasBox(page);
    await page.keyboard.press("n");
    await page.mouse.click(canvas.x + 520, canvas.y + 640);
    const editor = page.getByRole("textbox", { name: "Text for sticky note" });
    await editor.fill("Written offline");
    await editor.press("Control+Enter");

    // Visible locally, not on the server, and kept in the durable queue.
    await expect(page.getByText("Written offline")).toBeVisible();
    await expect(page.getByText("2 unsaved changes")).toBeVisible();
    expect((await serverState()).lastSequence).toBe(0);
    const queued = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("foreman:pending:"))
        .map((key) => JSON.parse(localStorage.getItem(key)!).length),
    );
    expect(queued).toEqual([2]);

    await context.setOffline(false);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const state = await serverState();
    expect(state.objects.some((object) => object.props.text === "Written offline")).toBe(true);
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("foreman:pending:")).length),
    ).toBe(0);
  });

  test("keeps unsent work across a reload", async ({ openBoard, serverState, context }) => {
    const page = await openBoard("ada");
    await context.setOffline(true);
    const centre = await objectCentre(page, "Example: define the goal");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press("Delete");
    await expect(page.getByText("Example: define the goal")).toHaveCount(0);
    expect((await serverState()).lastSequence).toBe(0);

    await context.setOffline(false);
    // Reload before the queue could have been flushed by a slow connection: the stored operation is resent.
    await page.reload();
    await expect(page.getByTestId("canvas-stage")).toBeVisible();
    await expect
      .poll(async () => (await serverState()).objects.find((o) => o.props.text === "Example: define the goal")?.deleted)
      .toBe(true);
    await expect(page.getByText("Example: define the goal")).toHaveCount(0);
    // Applied exactly once.
    expect((await serverState()).log.filter((entry) => entry.type === "OBJECT_DELETED")).toHaveLength(1);
  });

  test("catches up on operations whose realtime events were missed", async ({ openBoard, control }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    await control("drop-operation-events", { drop: true });

    const first = await objectCentre(ada, "Example: define the goal");
    await ada.mouse.click(first.x, first.y);
    await ada.keyboard.press("Delete");
    // Ben was never told.
    await ben.waitForTimeout(400);
    await expect(ben.getByText("Example: define the goal")).toBeVisible();

    await control("drop-operation-events", { drop: false });
    const second = await objectCentre(ada, "Example: list milestones");
    await ada.mouse.click(second.x, second.y);
    await ada.keyboard.press("Delete");

    // Seeing sequence 2 without sequence 1, Ben fetches what he missed.
    await expect(ben.getByText("Example: list milestones")).toHaveCount(0);
    await expect(ben.getByText("Example: define the goal")).toHaveCount(0);
  });

  test("shows a persistent banner when saving is refused, and keeps the work", async ({
    openBoard,
    control,
    serverState,
  }) => {
    const page = await openBoard("ada");
    await control("fail-next", { code: "BOARD_ACCESS_DENIED", times: 1 });
    const centre = await objectCentre(page, "Example: define the goal");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press("Delete");

    const banner = page.getByRole("alert").filter({ hasText: "Sync failed." });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("1 change is waiting on this device.");
    await expect(page.getByRole("status").filter({ hasText: "Sync failed" })).toBeVisible();
    expect((await serverState()).lastSequence).toBe(0);

    await banner.getByRole("button", { name: "Try again" }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => (await serverState()).lastSequence).toBe(1);
  });

  test("tells the user when a concurrent text edit wins", async ({ openBoard, context, browser }) => {
    const ada = await openBoard("ada");
    const benContext = await browser.newContext();
    const ben = await openBoard("ben", { context: benContext });

    await benContext.setOffline(true);
    await doubleClickObject(ben, "Example: first deliverable");
    const benEditor = ben.getByRole("textbox", { name: "Text for sticky note" });
    await benEditor.fill("Ben's wording");
    await benEditor.press("Control+Enter");

    await doubleClickObject(ada, "Example: first deliverable");
    const adaEditor = ada.getByRole("textbox", { name: "Text for sticky note" });
    await adaEditor.fill("Ada's wording");
    await adaEditor.press("Control+Enter");
    await expect(ada.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await benContext.setOffline(false);
    await expect(ben.getByText("Ada's wording")).toBeVisible();
    await expect(ben.getByText("Ben's wording")).toHaveCount(0);
    await expect(ben.getByRole("alert").filter({ hasText: "Someone else edited that text first." })).toBeVisible();
    await benContext.close();
    expect(context).toBeTruthy();
  });
});

test.describe("export", () => {
  test("downloads a real PNG of the canvas and records the export", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export as PNG" });
    await expect(dialog.getByRole("radio", { name: /Whole board/ })).toBeChecked();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Export PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^foreman-launch-plan-\d{4}-\d{2}-\d{2}\.png$/);
    const bytes = readFileSync((await download.path())!);
    // PNG signature, then the IHDR chunk with the image size.
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThan(1500);
    expect(height).toBeGreaterThan(1000);
    expect(bytes.length).toBeGreaterThan(20_000);

    await expect(dialog.getByText(/Saved as foreman-launch-plan-.*\.png/)).toBeVisible();
    await expect.poll(async () => (await serverState()).activity[0]).toBe("BOARD_EXPORTED");

    // The image really contains the board: decode it and look for the column and note colours.
    const colours = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set<string>();
      for (let index = 0; index < data.length; index += 4 * 97) {
        seen.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      }
      return [...seen];
    }, bytes.toString("base64"));
    expect(colours).toContain("252,250,246"); // background
    expect(colours).toContain("168,216,240"); // sky sticky note
    expect(colours).toContain("230,243,250"); // Plan column
    expect(colours).toContain("174,185,244"); // lavender sticky note
  });

  test("excludes other people's cursors and the panels from the image", async ({ openBoard }) => {
    const ada = await openBoard("ada");
    const ben = await openBoard("ben");
    const canvas = await canvasBox(ben);
    await ben.mouse.move(canvas.x + 300, canvas.y + 300);
    await ben.mouse.move(canvas.x + 320, canvas.y + 320, { steps: 3 });
    await expect(ada.getByTestId("remote-cursor")).toHaveCount(1);

    await ada.getByRole("button", { name: "Export" }).click();
    const dialog = ada.getByRole("dialog", { name: "Export as PNG" });
    await dialog.getByRole("radio", { name: /Current view/ }).check();
    const [download] = await Promise.all([
      ada.waitForEvent("download"),
      dialog.getByRole("button", { name: "Export PNG" }).click(),
    ]);
    const bytes = readFileSync((await download.path())!);

    // Ben's cursor colour and the panel's avatar colours do not appear anywhere in the pixels.
    const hasCursorColour = await ada.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const cursorColours = new Set([
        "37,99,235",
        "192,57,43",
        "38,138,87",
        "183,121,31",
        "124,58,237",
        "14,116,144",
        "190,24,93",
        "77,124,15",
      ]);
      for (let index = 0; index < data.length; index += 4) {
        if (cursorColours.has(`${data[index]},${data[index + 1]},${data[index + 2]}`)) return true;
      }
      return false;
    }, bytes.toString("base64"));
    expect(hasCursorColour).toBe(false);
  });

  test("explains why an empty board cannot be exported", async ({ openBoard, control }) => {
    await control("reset", { template: false });
    const page = await openBoard("ada");
    await expect(page.getByText("This board is empty", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export as PNG" });
    await expect(dialog.getByText("This board is empty, so there is nothing to export yet.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Export PNG" })).toBeDisabled();
  });
});

test.describe("activity and empty states", () => {
  test("lists real server-recorded activity, newest first", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.getByRole("tab", { name: "Activity" }).click();
    const feed = page.getByRole("list", { name: "Board activity, newest first" });
    await expect(feed.getByRole("listitem")).toHaveCount(1);
    await expect(feed.getByRole("listitem").first()).toContainText("Ada Okafor created this board");

    const centre = await objectCentre(page, "Example: define the goal");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press("Delete");
    await expect(feed.getByRole("listitem").first()).toContainText("Ada Okafor deleted a sticky note");
    await expect(feed.getByRole("listitem")).toHaveCount(2);
  });
});
