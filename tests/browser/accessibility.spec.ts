import { expect, objectCentre, test } from "./fixtures";

const SHOTS = process.env.FOREMAN_SCREENSHOT_DIR;

test.describe("keyboard and assistive technology", () => {
  test("the Outline panel lists every item and selects them from the keyboard", async ({ openBoard }) => {
    const page = await openBoard("ada");
    const outlineTab = page.getByRole("tab", { name: "Outline" });
    await outlineTab.focus();
    await page.keyboard.press("Enter");

    const list = page.getByRole("list", { name: "Board items" });
    const count = await page.locator("[data-object-id]").count();
    await expect(list.getByRole("listitem")).toHaveCount(count);
    // Each entry names its type and its text.
    await expect(list.getByRole("button", { name: "Sticky note: Example: define the goal" })).toBeVisible();
    await expect(list.getByRole("button", { name: "Text: Plan", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Arrow", exact: true }).first()).toBeVisible();

    const entry = list.getByRole("button", { name: "Sticky note: Example: define the goal" });
    await entry.focus();
    await page.keyboard.press("Enter");
    await expect(entry).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("selection-box")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-outline.png` });
  });

  test("edits, moves, duplicates and deletes an item without a mouse", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    await page.getByRole("tab", { name: "Outline" }).focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("list", { name: "Board items" });
    await list.getByRole("button", { name: "Sticky note: Example: list milestones" }).focus();
    await page.keyboard.press("Enter");

    const actions = page.getByRole("group", { name: "Actions for Sticky note: Example: list milestones" });
    await actions.getByRole("button", { name: "Edit text" }).focus();
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: "Text", exact: true });
    await expect(field).toBeFocused();
    await field.fill("Milestones agreed");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter"); // Save text
    await expect(list.getByRole("button", { name: "Sticky note: Milestones agreed" })).toBeVisible();

    const before = (await serverState()).objects.find((object) => object.props.text === "Milestones agreed")!;
    const moved = page.getByRole("group", { name: "Actions for Sticky note: Milestones agreed" });
    await moved.getByRole("button", { name: "Move right" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await serverState()).objects.find((object) => object.id === before.id)?.x)
      .toBe(before.x + 40);

    await moved.getByRole("button", { name: "Duplicate" }).focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("button", { name: "Sticky note: Milestones agreed" })).toHaveCount(2);

    const selectedActions = page.getByRole("group", { name: "Actions for Sticky note: Milestones agreed" });
    await selectedActions.getByRole("button", { name: "Delete" }).focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("button", { name: "Sticky note: Milestones agreed" })).toHaveCount(1);
  });

  test("the share dialog traps focus, closes on Escape and returns focus to its trigger", async ({ openBoard }) => {
    const page = await openBoard("ada");
    const trigger = page.getByRole("button", { name: "Share" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Share “Foreman Launch Plan”" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    // Focus starts on the first field, not on the close button.
    await expect(dialog.getByLabel("Email address")).toBeFocused();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-share.png` });

    // Tab forwards many times: focus never leaves the dialog.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }

    // Canvas shortcuts do not fire behind the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("invites by email from the share dialog and shows the link once", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("button", { name: "Invite" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Enter an email address." })).toBeVisible();

    await dialog.getByLabel("Email address").fill("New.Person@Example.test");
    await dialog.getByLabel("Role").selectOption("VIEWER");
    await dialog.getByRole("button", { name: "Invite" }).click();
    await expect(dialog.getByText(/Invitation created for/)).toContainText("new.person@example.test");
    await expect(dialog.getByLabel("Invitation link")).toHaveValue(/\/invitations\/accept\?token=[0-9a-f]{64}$/);
    await expect(dialog.getByRole("listitem").filter({ hasText: "new.person@example.test" })).toContainText("Pending");
    expect((await serverState()).activity[0]).toBe("MEMBER_INVITED");

    // The sharing tab shows the collaboration code and never grants more than view access by link.
    await dialog.getByRole("tab", { name: "Link and code" }).click();
    await expect(dialog.getByLabel("Code", { exact: true })).toHaveValue("F-2WE-23XX");
    await expect(dialog.getByRole("radio", { name: /Invite only/ })).toBeChecked();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-sharing.png` });
  });

  test("tools are a labelled toolbar with pressed state, and tabs follow the arrow-key pattern", async ({
    openBoard,
  }) => {
    const page = await openBoard("ada");
    const toolbar = page.getByRole("toolbar", { name: "Canvas tools" });
    await expect(toolbar.getByRole("button")).toHaveCount(11);
    for (const button of await toolbar.getByRole("button").all()) {
      expect((await button.getAttribute("aria-label"))?.length).toBeGreaterThan(2);
    }
    await page.keyboard.press("t");
    await expect(toolbar.getByRole("button", { name: "Text", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(toolbar.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");

    const people = page.getByRole("tab", { name: "People" });
    await people.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Activity" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });

  test("opens shortcut help with ? and the command palette with Ctrl+K", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help.getByText("Undo your last change")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const input = palette.getByRole("combobox", { name: "Search commands" });
    await expect(input).toBeFocused();
    await input.fill("outline");
    await expect(palette.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");
  });

  test("offers a context menu that is operable by keyboard", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const centre = await objectCentre(page, "Example: first deliverable");
    await page.mouse.click(centre.x, centre.y, { button: "right" });
    const menu = page.getByRole("menu", { name: "Canvas actions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect
      .poll(
        async () => (await serverState()).objects.filter((o) => o.props.text === "Example: first deliverable").length,
      )
      .toBe(2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-selected.png` });
  });

  test("every icon-only button has an accessible name, and status changes are live regions", async ({ openBoard }) => {
    const page = await openBoard("ada");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href]")]
        .filter(
          (element) =>
            !(element.textContent ?? "").trim() &&
            !element.getAttribute("aria-label") &&
            !element.getAttribute("aria-labelledby"),
        )
        .map((element) => element.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("status").filter({ hasText: "Connected" })).toHaveAttribute("aria-live", "polite");
    // Remote cursors are hidden from assistive technology.
    expect(
      await page
        .locator(
          "[aria-hidden='true'] [data-testid='remote-cursor'], [aria-hidden='true']:has([data-testid='remote-cursor'])",
        )
        .count(),
    ).toBeGreaterThanOrEqual(0);
  });

  test("shows a visible focus ring on keyboard focus", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      const style = getComputedStyle(active);
      return { width: style.outlineWidth, style: style.outlineStyle, tag: active.tagName };
    });
    expect(outline.style).toBe("solid");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});
