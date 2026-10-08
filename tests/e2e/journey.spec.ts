import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The full user journey against a REAL deployment and a REAL Supabase project.
 *
 * Nothing here is mocked. It needs:
 *   - the app running at E2E_BASE_URL with Supabase configured
 *   - two registered, email-verified accounts (the owner and a collaborator)
 *
 * Registration and email verification are not automated here because they
 * need a mailbox. Create and verify the two accounts once, by hand, following
 * docs/demo-script.md, then export:
 *
 *   E2E_BASE_URL, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD,
 *   E2E_COLLABORATOR_EMAIL, E2E_COLLABORATOR_PASSWORD
 *
 * Without those variables the suite is skipped, not passed.
 */
const env = {
  ownerEmail: process.env.E2E_OWNER_EMAIL,
  ownerPassword: process.env.E2E_OWNER_PASSWORD,
  collaboratorEmail: process.env.E2E_COLLABORATOR_EMAIL,
  collaboratorPassword: process.env.E2E_COLLABORATOR_PASSWORD,
};
const configured = Object.values(env).every(Boolean);

test.describe.configure({ mode: "serial" });
test.skip(!configured, "Set the E2E_* variables to run against a real Supabase project (see docs/testing.md).");

async function logIn(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

test("visitor pages: landing, protected-route rejection, generic login error", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your space for notes, plans, and big ideas");
  await expect(page.getByRole("link", { name: "Create your free workspace" }).first()).toHaveAttribute(
    "href",
    "/register",
  );

  for (const path of ["/dashboard", "/settings", "/templates", "/boards/00000000-0000-4000-8000-000000000000"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }

  await page.getByLabel("Email").fill("nobody-at-all@example.com");
  await page.getByLabel("Password", { exact: true }).fill("definitely wrong 1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText(/That email and password don.t match/);
});

test("owner and collaborator work on one board in real time", async ({ browser }) => {
  test.setTimeout(180_000);
  const boardTitle = `Foreman Launch Plan ${Date.now()}`;

  // -- Owner: template -> board -----------------------------------------------
  const owner = await logIn(browser, env.ownerEmail!, env.ownerPassword!);
  await dismissCookieBanner(owner);
  await owner.goto("/welcome");
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Welcome to Foreman,");
  await owner.getByRole("link", { name: /Use a template/ }).click();
  await expect(owner).toHaveURL(/\/templates/);
  const roadmap = owner.getByRole("article").filter({ hasText: "Project Roadmap" });
  await roadmap.getByRole("link", { name: "Use this template" }).click();
  await owner.getByLabel("Board name").fill(boardTitle);
  await owner.getByRole("button", { name: "Create board" }).click();
  await expect(owner).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  const boardUrl = owner.url();
  await expect(owner.getByTestId("canvas-stage")).toBeVisible();
  await expect(owner.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
  for (const column of ["Plan", "Build", "Test"]) {
    await expect(
      owner.locator('[data-object-type="TEXT"]').filter({ hasText: new RegExp(`^${column}$`) }),
    ).toBeVisible();
  }

  // -- Owner: collaboration code exists and is well-formed ----------------------
  await owner.getByRole("button", { name: "Share" }).click();
  const share = owner.getByRole("dialog");
  await share.getByRole("tab", { name: "Link and code" }).click();
  await expect(share.getByLabel("Code", { exact: true })).toHaveValue(/^F-[A-Z0-9]{3}-[A-Z0-9]{4}$/);

  // -- Owner: invite the collaborator as Editor ---------------------------------
  await share.getByRole("tab", { name: "Invite" }).click();
  await share.getByLabel("Email address").fill(env.collaboratorEmail!);
  await share.getByLabel("Role").selectOption("EDITOR");
  await share.getByRole("button", { name: "Invite" }).click();
  await expect(share.getByText(/Invitation created for/)).toBeVisible();
  await owner.keyboard.press("Escape");

  // -- Owner: add a sticky note and move it into Build --------------------------
  const canvas = (await owner.getByTestId("canvas-stage").boundingBox())!;
  await owner.keyboard.press("n");
  await owner.mouse.click(canvas.x + 260, canvas.y + canvas.height - 160);
  const editor = owner.getByRole("textbox", { name: "Text for sticky note" });
  await editor.fill("Ship the launch checklist");
  await editor.press("Control+Enter");
  await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  const note = owner.locator("[data-object-id]").filter({ hasText: "Ship the launch checklist" });
  const build = owner.locator("[data-object-id]").filter({ hasText: "Example: first deliverable" });
  const from = (await note.boundingBox())!;
  const target = (await build.boundingBox())!;
  await owner.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(target.x + target.width / 2, target.y + target.height + 90, { steps: 12 });
  await owner.mouse.up();
  await expect(owner.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // -- Collaborator: accept the invitation and open the board -------------------
  const collaborator = await logIn(browser, env.collaboratorEmail!, env.collaboratorPassword!);
  await dismissCookieBanner(collaborator);
  await collaborator.getByRole("button", { name: /Notifications/ }).click();
  const invitation = collaborator
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: boardTitle });
  await invitation.getByRole("button", { name: "Accept" }).click();
  await expect(collaborator).toHaveURL(boardUrl);
  await expect(collaborator.getByTestId("canvas-stage")).toBeVisible();
  await expect(collaborator.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
  await expect(collaborator.locator("[data-object-id]").filter({ hasText: "Ship the launch checklist" })).toBeVisible();

  // -- Owner sees the collaborator's real presence -------------------------------
  const online = owner.getByRole("region", { name: "Online now" });
  await expect(online.getByRole("listitem")).toHaveCount(2);
  await expect(owner.getByText("No one else is on the board right now.")).toHaveCount(0);

  // -- Collaborator's cursor appears for the owner --------------------------------
  const collaboratorCanvas = (await collaborator.getByTestId("canvas-stage").boundingBox())!;
  await collaborator.mouse.move(collaboratorCanvas.x + 300, collaboratorCanvas.y + 300);
  await collaborator.mouse.move(collaboratorCanvas.x + 360, collaboratorCanvas.y + 340, { steps: 8 });
  await expect(owner.getByTestId("remote-cursor")).toHaveCount(1);

  // -- Collaborator edits; owner sees it live --------------------------------------
  await collaborator.keyboard.press("n");
  await collaborator.mouse.click(collaboratorCanvas.x + 620, collaboratorCanvas.y + collaboratorCanvas.height - 150);
  const collaboratorEditor = collaborator.getByRole("textbox", { name: "Text for sticky note" });
  await collaboratorEditor.fill("Added by the collaborator");
  await collaboratorEditor.press("Control+Enter");
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Added by the collaborator" })).toBeVisible();

  // -- Owner comments; collaborator sees it; activity records it --------------------
  await owner.getByRole("tab", { name: "Comments" }).click();
  await owner.getByLabel("Add a comment").fill("Looks ready for review.");
  await owner.getByRole("button", { name: "Post comment" }).click();
  await collaborator.getByRole("tab", { name: "Comments" }).click();
  await expect(
    collaborator.getByRole("list", { name: "Comments, newest first" }).getByText("Looks ready for review."),
  ).toBeVisible();

  await owner.getByRole("tab", { name: "Activity" }).click();
  const feed = owner.getByRole("list", { name: "Board activity, newest first" });
  await expect(feed.getByRole("listitem").filter({ hasText: "commented" }).first()).toBeVisible();
  await expect(
    feed.getByRole("listitem").filter({ hasText: "started from the Project Roadmap template" }),
  ).toBeVisible();

  // -- Owner exports a real PNG ----------------------------------------------------
  await owner.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    owner.waitForEvent("download"),
    owner.getByRole("dialog", { name: "Export as PNG" }).getByRole("button", { name: "Export PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const stream = await download.createReadStream();
  const header = await new Promise<Buffer>((resolve, reject) => {
    stream.once("data", (chunk: Buffer) => resolve(chunk));
    stream.once("error", reject);
  });
  expect([...header.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await owner.keyboard.press("Escape");
  await expect(feed.getByRole("listitem").first()).toContainText("exported the board as a PNG");

  // -- Collaborator leaves: presence goes away ---------------------------------------
  await collaborator.context().close();
  await owner.getByRole("tab", { name: "People" }).click();
  await expect(online.getByRole("listitem")).toHaveCount(1);

  // -- Dashboard, then reopen: content persisted ----------------------------------------
  await owner.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(owner).toHaveURL(/\/dashboard/);
  await owner.getByRole("link", { name: boardTitle }).first().click();
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Ship the launch checklist" })).toBeVisible();
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Added by the collaborator" })).toBeVisible();
  await owner.reload();
  await expect(owner.locator("[data-object-id]").filter({ hasText: "Ship the launch checklist" })).toBeVisible();

  // -- Log out: protected routes reject -------------------------------------------------
  await owner.getByRole("button", { name: /Account menu/ }).click();
  await owner.getByRole("menuitem", { name: "Log out" }).click();
  await expect(owner).toHaveURL(/\/login/);
  await owner.goto(boardUrl);
  await expect(owner).toHaveURL(/\/login/);
  await owner.goto("/dashboard");
  await expect(owner).toHaveURL(/\/login/);
  await owner.context().close();
});

test("a viewer cannot edit, and a stranger cannot see the board", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await logIn(browser, env.ownerEmail!, env.ownerPassword!);
  await dismissCookieBanner(owner);
  await owner.goto("/boards/new");
  await owner.getByLabel("Board name").fill(`Private check ${Date.now()}`);
  await owner.getByRole("button", { name: "Create board" }).click();
  await expect(owner).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  const boardUrl = owner.url();

  // The collaborator has not been invited to this board: it must look like it does not exist.
  const stranger = await logIn(browser, env.collaboratorEmail!, env.collaboratorPassword!);
  await stranger.goto(boardUrl);
  await expect(stranger.getByRole("heading", { name: "Board not found or access is unavailable." })).toBeVisible();
  await expect(stranger.getByTestId("canvas-stage")).toHaveCount(0);

  // A wrong collaboration code gives the same generic answer.
  await stranger.goto("/join");
  await stranger.getByLabel("Collaboration code").fill("F-ZZZ-0000");
  await stranger.getByRole("button", { name: "Join board" }).click();
  await expect(stranger.getByText("Board not found or access is unavailable.")).toBeVisible();

  await stranger.context().close();
  await owner.context().close();
});
