import type { Locator, Page } from "@playwright/test";
import { expect, objectCentre, test } from "./fixtures";

const SHOTS = process.env.FOREMAN_SCREENSHOT_DIR;

async function noHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** Every button is at least 44×44 and neighbours are at least 12px apart. */
async function touchFriendly(buttons: Locator) {
  const boxes = [];
  for (const button of await buttons.all()) boxes.push((await button.boundingBox())!);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index].x - (boxes[index - 1].x + boxes[index - 1].width)).toBeGreaterThanOrEqual(11.5);
  }
}

for (const size of [
  { width: 393, height: 852 },
  { width: 430, height: 932 },
]) {
  test.describe(`phone ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test("canvas fills the screen with a floating top bar and a labelled bottom toolbar", async ({ openBoard }) => {
      const page = await openBoard("ada");
      const bar = page.getByRole("navigation", { name: "Board actions" });
      await expect(bar).toBeVisible();
      const buttons = bar.getByRole("button");
      await expect(buttons).toHaveText(["Add", "Select", "Comments", "Outline", "Assistant", "More"]);
      await touchFriendly(buttons);

      // The desktop toolbar, tool rail and side panel are not shown on a phone.
      await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeHidden();
      await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeHidden();
      await expect(page.getByRole("complementary", { name: "Collaboration panel" })).toBeHidden();
      const canvas = (await page.getByTestId("canvas-stage").boundingBox())!;
      expect(canvas.y).toBe(0);
      expect(canvas.height).toBe(size.height);
      await noHorizontalScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-${size.width}.png` });
    });

    test("Add places a sticky note with a tap", async ({ openBoard, serverState }) => {
      const page = await openBoard("ada");
      const before = (await serverState()).objects.length;
      await page.getByRole("navigation", { name: "Board actions" }).getByRole("button", { name: "Add" }).click();
      const sheet = page.getByRole("dialog", { name: "Add to the board" });
      await expect(sheet).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-${size.width}-add.png` });
      await sheet.getByRole("button", { name: "Sticky note" }).click();
      await expect(sheet).toBeHidden();
      await page.touchscreen.tap(size.width / 2, size.height - 160);
      await expect.poll(async () => (await serverState()).objects.length).toBe(before + 1);
    });

    test("Assistant opens as a bottom sheet, not a right-hand panel", async ({ openBoard }) => {
      const page = await openBoard("ada");
      await page.getByRole("navigation", { name: "Board actions" }).getByRole("button", { name: "Assistant" }).click();
      const panel = page.getByRole("complementary", { name: "Foreman Assistant" });
      await expect(panel).toBeVisible();
      // Let the sheet finish rising.
      await expect
        .poll(async () => Math.round((await panel.boundingBox())!.y + (await panel.boundingBox())!.height))
        .toBe(size.height);
      const box = (await panel.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBe(size.width);
      expect(box.y).toBeGreaterThan(size.height * 0.1);
      await noHorizontalScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-${size.width}-assistant.png` });
      await page.getByRole("button", { name: "Close Assistant" }).click();
      await expect(panel).toBeHidden();
    });

    test("Comments open as a bottom sheet", async ({ openBoard }) => {
      const page = await openBoard("ada");
      await page.getByRole("navigation", { name: "Board actions" }).getByRole("button", { name: "Comments" }).click();
      const panel = page.getByRole("complementary", { name: "Collaboration panel" });
      await expect(panel).toBeVisible();
      await expect(page.getByLabel("Add a comment")).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.width).toBe(size.width);
    });

    test("More sheet has labelled actions and the theme choice", async ({ openBoard }) => {
      const page = await openBoard("ada");
      await page.getByRole("navigation", { name: "Board actions" }).getByRole("button", { name: "More" }).click();
      const sheet = page.getByRole("dialog", { name: "More" });
      for (const name of ["Export", "Share", "Zoom to fit", "Board settings", "Shortcuts", "Help"]) {
        await expect(
          sheet.getByRole(name.includes("settings") || name === "Help" ? "link" : "button", { name }),
        ).toBeVisible();
      }
      await sheet.getByText("Dark", { exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-${size.width}-more-dark.png` });
    });

    test("press and hold an item opens its menu (the touch right-click)", async ({ openBoard }) => {
      const page = await openBoard("ada");
      const centre = await objectCentre(page, "Example: define the goal");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
      await page.waitForTimeout(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const menu = page.getByRole("menu", { name: "Canvas actions" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    });
  });
}

test.describe("tablet 744×1133", () => {
  test.use({ viewport: { width: 744, height: 1133 }, hasTouch: true });
  test("uses the side tool rail; no phone bar and no desktop toolbar", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Board actions" })).toBeHidden();
    await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeHidden();
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tablet-744.png` });
  });
});

test.describe("tablet 1024×1366", () => {
  test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
  test("tool rail, More menu and a panel beside the board", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await expect(page.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    const panel = (await page.getByRole("complementary", { name: "Collaboration panel" }).boundingBox())!;
    const canvas = (await page.getByTestId("canvas-stage").boundingBox())!;
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x + 1);
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tablet-1024.png` });
  });
});

test.describe("desktop 1440×900", () => {
  test("Shift+click selects several items, and Align left lines them up", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const a = await objectCentre(page, "Example: define the goal");
    const b = await objectCentre(page, "Example: first deliverable");
    await page.mouse.click(a.x, a.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up("Shift");
    await expect(page.getByTestId("selection-extra")).toHaveCount(1);
    await expect(page.getByText("2 items selected")).toBeAttached();

    const toolbar = page.getByRole("toolbar", { name: "Board tools" });
    await toolbar.getByRole("button", { name: "Align left" }).click();
    await expect
      .poll(async () => {
        const objects = (await serverState()).objects;
        const xs = ["Example: define the goal", "Example: first deliverable"].map(
          (text) => objects.find((object) => object.props.text === text)!.x,
        );
        return xs[0] === xs[1];
      })
      .toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-1440-multiselect.png` });
  });

  test("More menu offers export, settings, shortcuts, help and theme", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.getByRole("button", { name: "More" }).click();
    const menu = page.getByRole("menu", { name: "More board options" });
    for (const name of ["Export as PNG", "Board settings", "Keyboard shortcuts", "Help and what’s new"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
    await menu.getByRole("menuitemradio", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("Bring forward and Send backward change the stacking order", async ({ openBoard, serverState }) => {
    const page = await openBoard("ada");
    const centre = await objectCentre(page, "Example: define the goal");
    await page.mouse.click(centre.x, centre.y);
    const find = async () =>
      (
        (await serverState()).objects.find((object) => object.props.text === "Example: define the goal") as unknown as {
          z_index: number;
        }
      ).z_index;
    const start = await find();
    await page.getByRole("toolbar", { name: "Board tools" }).getByRole("button", { name: "Bring forward" }).click();
    await expect.poll(find).toBeGreaterThan(start);
    await page.getByRole("toolbar", { name: "Board tools" }).getByRole("button", { name: "Send backward" }).click();
    await expect.poll(find).toBe(start);
  });
});
