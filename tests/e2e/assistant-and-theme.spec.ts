import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Assistant v1.1/v1.2 and theme preference against a REAL Supabase project, so the
 * 20261104… migrations are exercised end to end: the snapshot, ranking fields,
 * feedback storage, accept, undo, stale detection and the saved theme.
 *
 * Same accounts and variables as journey.spec.ts; only the owner account is used.
 * The app must run with ASSISTANT_ENABLED=true (render.yaml sets it; locally put it
 * in .env.local before `npm run build`).
 */
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const configured = Boolean(
  ownerEmail && ownerPassword && process.env.E2E_COLLABORATOR_EMAIL && process.env.E2E_COLLABORATOR_PASSWORD,
);

test.describe.configure({ mode: "serial" });
test.skip(!configured, "Set the E2E_* variables to run against a real Supabase project (see docs/testing.md).");

const QUESTION = "Who owns onboarding?";

async function logIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(ownerEmail!);
  await page.getByLabel("Password", { exact: true }).fill(ownerPassword!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click();
  return page;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Foreman Assistant" });
const card = (page: Page) => panel(page).getByRole("listitem", { name: "Unanswered question" }).first();

async function addNote(page: Page, text: string, dx: number, dyFromBottom: number) {
  const canvas = (await page.getByTestId("canvas-stage").boundingBox())!;
  await page.keyboard.press("n");
  await page.mouse.click(canvas.x + dx, canvas.y + canvas.height - dyFromBottom);
  const editor = page.getByRole("textbox", { name: "Text for sticky note" });
  await editor.fill(text);
  await editor.press("Control+Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

async function openAssistant(page: Page) {
  if (!(await panel(page).isVisible())) await page.getByRole("button", { name: "Foreman Assistant" }).click();
  await expect(panel(page)).toBeVisible();
}

test("Assistant v1.1/v1.2 on a real board: bands, clarity, feedback, accept, undo, stale", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await logIn(browser);
  await owner.goto("/boards/new");
  await owner.getByLabel("Board name").fill(`Assistant check ${Date.now()}`);
  await owner.getByRole("button", { name: "Create board" }).click();
  await expect(owner).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  await expect(owner.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
  await addNote(owner, QUESTION, 260, 260);

  // Run: snapshot + rules + create_run against the real database.
  await openAssistant(owner);
  await panel(owner).getByRole("button", { name: "Run" }).click();
  await expect(card(owner)).toBeVisible();
  await expect(card(owner).getByText(/^(Clear|Likely|Possible)$/)).toBeVisible();
  await expect(panel(owner).getByRole("meter", { name: "Planning clarity" })).toBeVisible();

  // Feedback is stored and comes back after a reload.
  await card(owner).getByRole("button", { name: "Helpful" }).click();
  await expect(card(owner).getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
  await owner.waitForTimeout(1_000);
  await owner.reload();
  await openAssistant(owner);
  await expect(card(owner).getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");

  // Accept adds exactly one note; undo removes only that note.
  await card(owner).getByRole("button", { name: "Accept" }).click();
  await expect(card(owner).getByText("Added to the board")).toBeVisible();
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Decide:" })).toHaveCount(1);
  await card(owner)
    .getByRole("button", { name: /Undo this/ })
    .click();
  await expect(card(owner).getByText("Undone")).toBeVisible();
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Decide:" })).toHaveCount(0);
  await expect(owner.locator("[data-object-id]").filter({ hasText: QUESTION })).toHaveCount(1);

  // Stale: change the evidence note after a run; the proposal can no longer be accepted.
  await panel(owner).getByRole("button", { name: "Run" }).click();
  await expect(card(owner)).toBeVisible();
  await owner.locator("[data-object-id]").filter({ hasText: QUESTION }).dblclick();
  const editor = owner.getByRole("textbox", { name: "Text for sticky note" });
  await editor.fill("Who owns onboarding? Still open");
  await editor.press("Control+Enter");
  await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(card(owner).getByText(/board changed since this was suggested/i)).toBeVisible();
  await expect(card(owner).getByRole("button", { name: "Accept" })).toBeDisabled();

  await owner.context().close();
});

test("theme preference is saved on the account", async ({ browser }) => {
  test.setTimeout(90_000);
  const first = await logIn(browser);
  await first
    .getByRole("button", { name: /Account menu/ })
    .first()
    .click();
  await first.getByRole("menuitemradio", { name: "Dark theme" }).click();
  await expect(first.locator("html")).toHaveAttribute("data-theme", "dark");
  await first.waitForTimeout(1_000);
  await first.reload();
  await expect(first.locator("html")).toHaveAttribute("data-theme", "dark");

  // A brand-new browser session (no local choice) picks it up from the account.
  const second = await logIn(browser);
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");

  // Leave the account as it was.
  await second
    .getByRole("button", { name: /Account menu/ })
    .first()
    .click();
  await second.getByRole("menuitemradio", { name: "System theme" }).click();
  await second.waitForTimeout(1_000);
  await first.context().close();
  await second.context().close();
});
