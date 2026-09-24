import { test, expect } from "@playwright/test";
import { gotoWithDoc } from "./helpers";

test("clicking a leaf directive opens a popover pre-filled with its attributes", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();

  const popover = page.locator(".ox-directive-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".ox-directive-popover-title")).toHaveText(
    "::badge",
  );
  await expect(popover.locator(".ox-directive-popover-key")).toHaveValue(
    "label",
  );
  await expect(popover.locator(".ox-directive-popover-value")).toHaveValue(
    "Ready",
  );
});

test("editing an attribute and saving updates the rendered directive", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();

  const popover = page.locator(".ox-directive-popover");
  await popover.locator(".ox-directive-popover-value").fill("Shipped");
  await popover.locator(".ox-directive-popover-save").click();

  await expect(popover).not.toBeVisible();
  await expect(page.locator(".ox-directive-badge")).toHaveText("Shipped");
});

test("adding a new attribute persists across a reopen", async ({ page }) => {
  await gotoWithDoc(page, '::mystery{x="1"}\n');
  await page.locator(".ox-directive-leaf").click();

  const popover = page.locator(".ox-directive-popover");
  await popover.locator(".ox-directive-popover-add").click();
  const rows = popover.locator(".ox-directive-popover-row");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator(".ox-directive-popover-key").fill("y");
  await rows.nth(1).locator(".ox-directive-popover-value").fill("2");
  await popover.locator(".ox-directive-popover-save").click();
  await expect(popover).not.toBeVisible();

  // Reopen and confirm both attributes are still there, in some order.
  await page.locator(".ox-directive-leaf").click();
  await expect(rows).toHaveCount(2);
  const values = await rows.evaluateAll((els) =>
    els.map((el) => [
      (el.querySelector(".ox-directive-popover-key") as HTMLInputElement).value,
      (el.querySelector(".ox-directive-popover-value") as HTMLInputElement).value,
    ]),
  );
  expect(values).toContainEqual(["x", "1"]);
  expect(values).toContainEqual(["y", "2"]);
});

test("cancel closes the popover without changing anything", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();

  const popover = page.locator(".ox-directive-popover");
  await popover.locator(".ox-directive-popover-value").fill("Changed");
  await popover.locator(".ox-directive-popover-cancel").click();

  await expect(popover).not.toBeVisible();
  await expect(page.locator(".ox-directive-badge")).toHaveText("Ready");
});

test("removing a directive deletes it entirely", async ({ page }) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();

  const popover = page.locator(".ox-directive-popover");
  await popover.locator(".ox-directive-popover-remove").click();

  await expect(popover).not.toBeVisible();
  await expect(page.locator(".ox-directive")).toHaveCount(0);
  await expect(page.locator(".taino-editor")).toContainText("plain paragraph");
});

test(":ref{...} never gets the attrs-editing popover — GraphLog is the only writer", async ({
  page,
}) => {
  await gotoWithDoc(
    page,
    'Decided on cedar :ref{name="Jane" location="/x"} today.\n',
  );
  await page.locator(".ox-directive-ref-glyph").click();
  await expect(page.locator(".ox-directive-popover")).not.toBeVisible();
});

test("clicking inside a container directive's own content edits normally, without opening the popover", async ({
  page,
}) => {
  await gotoWithDoc(page, ':::note{title="x"}\nhello\n:::\n');
  const container = page.locator(".ox-directive-container");

  // Click squarely on the nested paragraph's own text, not the
  // container's chrome.
  await container.locator("p").click();
  await expect(page.locator(".ox-directive-popover")).not.toBeVisible();
  await page.keyboard.type("!");
  await expect(container.locator("p")).toHaveText("hello!");

  // Clicking the container's own padding (away from any child), by
  // contrast, DOES open the popover.
  await container.click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".ox-directive-popover")).toBeVisible();
});
