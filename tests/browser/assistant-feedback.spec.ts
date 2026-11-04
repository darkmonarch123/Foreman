import { expect, test } from "./fixtures";

test("feedback hides a type of finding on the next run and can be undone", async ({ openBoard }) => {
  const page = await openBoard("ada");
  await page.getByRole("button", { name: "Foreman Assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Foreman Assistant" });
  await panel.getByRole("button", { name: "Run" }).click();
  const first = panel.locator("li[aria-labelledby^='finding-']").first();
  await expect(first).toBeVisible();
  await expect(panel.getByTestId("assistant-template")).toContainText("a staged plan with owners and next steps");
  await expect(first.getByText(/^(Clear|Likely|Possible)$/)).toBeVisible();
  const title = (await first.locator("h4").textContent())!;

  await first.getByRole("button", { name: "Not helpful" }).click();
  await first.getByRole("button", { name: "Too obvious" }).click();
  await first.getByRole("button", { name: "Hide this type of finding on this board" }).click();

  await panel.getByRole("button", { name: "Run" }).click();
  await expect(panel.getByText(/left out because of your feedback/)).toBeVisible();
  await expect(panel.locator("h4", { hasText: title })).toHaveCount(0);

  await panel.getByRole("button", { name: "Manage hidden findings" }).click();
  await panel
    .getByRole("list", { name: "Hidden types of finding" })
    .getByRole("button", { name: "Show again" })
    .click();
  await expect(panel.getByRole("list", { name: "Hidden types of finding" })).toHaveCount(0);
});
