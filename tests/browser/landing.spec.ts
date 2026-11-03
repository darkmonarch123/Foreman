import { expect, test, type Page } from "@playwright/test";

/**
 * The public landing page in a real browser, at the sizes it must support. The page
 * component renders unchanged in the harness (tests/browser/harness/landing.tsx).
 */

const VIEWPORTS = [
  { name: "iPhone 14 Pro", width: 393, height: 852, mobile: true },
  { name: "iPhone 14 Pro Max", width: 430, height: 932, mobile: true },
  { name: "iPad Mini", width: 744, height: 1133, mobile: true },
  { name: "Desktop", width: 1440, height: 900, mobile: false },
] as const;

const SECTIONS = [
  "Your space for notes, plans, and big ideas",
  "Five ways to work. One place to keep it all.",
  "From first thought to final form.",
  "Everything you need. Nothing you don’t.",
  "Start from a template.",
  "Free to start. Room to grow.",
  "Plan visually. Build together.",
];

async function open(page: Page) {
  await page.goto("/landing.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Widest horizontal overflow of the page, in CSS pixels (0 means none). */
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name} (${viewport.width}×${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.mobile });

    test("has every core section and no horizontal scrolling", async ({ page }) => {
      await open(page);
      for (const title of SECTIONS) {
        const heading = page.getByRole("heading", { name: title, exact: true });
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible();
        const box = (await heading.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
      }
      expect(await horizontalOverflow(page)).toBe(0);
    });

    test("uses the compact menu on small screens and inline links on large ones", async ({ page }) => {
      await open(page);
      const inline = page.getByRole("navigation", { name: "Primary" });
      const menuButton = page.getByRole("button", { name: "Open menu" });
      if (viewport.mobile) {
        await expect(inline).toBeHidden();
        await expect(menuButton).toBeVisible();
      } else {
        await expect(inline).toBeVisible();
        await expect(menuButton).toBeHidden();
      }
      await expect(page.getByRole("banner").getByRole("link", { name: "Create account" })).toBeVisible();
    });

    test("gives every visible button and link in the header and calls to action at least 44×44 px", async ({
      page,
    }) => {
      await open(page);
      const targets = [
        ...(await page.getByRole("banner").locator("a:visible, button:visible").all()),
        ...(await page.getByRole("link", { name: "Create your free workspace" }).all()),
        page.getByRole("link", { name: "Explore templates" }),
        page.getByRole("link", { name: "I already have an account" }),
      ];
      for (const target of targets) {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        if (!box) continue;
        expect(box.height, await target.innerText()).toBeGreaterThanOrEqual(44);
        expect(box.width, await target.innerText()).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true });

  test("the menu opens and closes, by button, Escape, and following a link", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: "Open menu" });
    const menu = page.getByRole("navigation", { name: "Menu" });
    await expect(menu).toBeHidden();

    await button.click();
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Product", "Templates", "Collaboration", "Pricing", "Log in"]) {
      await expect(menu.getByRole("link", { name })).toBeVisible();
    }
    expect(await horizontalOverflow(page)).toBe(0);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

    await page.getByRole("button", { name: "Open menu" }).click();
    await menu.getByRole("link", { name: "Pricing" }).click();
    await expect(menu).toBeHidden();
  });

  test("stays within the screen when the text is made much larger", async ({ page }) => {
    await open(page);
    await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
    await page.waitForTimeout(100);
    expect(await horizontalOverflow(page)).toBe(0);
    for (const title of SECTIONS) {
      const box = (await page.getByRole("heading", { name: title, exact: true }).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(393.5);
    }
  });

  test("a dragged board card springs back to its place", async ({ page }) => {
    await open(page);
    const card = page.locator("[data-canvas] .cursor-grab").first();
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 });
    const moved = (await card.boundingBox())!;
    expect(moved.x - box.x).toBeGreaterThan(40);
    await page.mouse.up();
    await expect.poll(async () => Math.abs(Math.round((await card.boundingBox())!.x - box.x))).toBe(0);
  });
});

test.describe("Dark Mode", () => {
  test("follows the system setting with its own colour tokens", async ({ browser }) => {
    for (const [scheme, background, text] of [
      ["light", "rgb(251, 251, 253)", "rgb(29, 29, 31)"],
      ["dark", "rgb(0, 0, 0)", "rgb(245, 245, 247)"],
    ] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 393, height: 852 } });
      const page = await context.newPage();
      await open(page);
      const colours = await page.evaluate(() => {
        const site = getComputedStyle(document.querySelector(".site")!);
        return {
          background: site.backgroundColor,
          color: site.color,
          token: site.getPropertyValue("--site-bg").trim(),
          scheme: site.colorScheme,
        };
      });
      expect(colours.background).toBe(background);
      expect(colours.color).toBe(text);
      expect(colours.scheme).toBe(scheme);
      expect(await horizontalOverflow(page)).toBe(0);
      await context.close();
    }
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test("shows everything without scroll effects", async ({ page }) => {
    await open(page);
    await expect(page.locator(".site")).toHaveAttribute("data-motion", "reduced");
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    expect(await page.locator("[data-hero]").evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    const dimmed = await page
      .locator("[data-statement] > span")
      .evaluateAll((words) => words.filter((word) => Number(getComputedStyle(word).opacity) < 1).length);
    expect(dimmed).toBe(0);
    const hidden = await page
      .locator("[data-reveal]")
      .evaluateAll((items) => items.filter((item) => Number(getComputedStyle(item).opacity) < 1).length);
    expect(hidden).toBe(0);
  });
});

test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows a visible focus ring on links and buttons", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { tag: element.tagName, outline: style.outlineStyle, width: style.outlineWidth };
    });
    expect(outline.tag).toBe("A");
    expect(outline.outline).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});
