import { expect, test } from "./fixtures";

const SHOTS = process.env.FOREMAN_SCREENSHOT_DIR;

test.describe("dark theme", () => {
  test("the board uses the dark tokens and draws content lightness-inverted", async ({ openBoard, context }) => {
    await context.addInitScript(() => window.localStorage.setItem("foreman:theme", "dark"));
    const page = await openBoard("ada");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const layer = await page.evaluate(() => ({
      filter: getComputedStyle(document.querySelector('[data-testid="canvas-stage"] svg.board-ink')!).filter,
      board: getComputedStyle(document.querySelector(".canvas-grid")!).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    // Content is drawn lightness-inverted; the board itself uses the dark surface token.
    expect(layer.filter).toBe("invert(0.9) hue-rotate(180deg)");
    expect(layer.board).toBe("rgb(22, 22, 27)");
    expect(layer.body).not.toBe("rgb(0, 0, 0)");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-dark.png` });
  });

  test("System follows the operating system", async ({ openBoard }) => {
    const page = await openBoard("ada");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
