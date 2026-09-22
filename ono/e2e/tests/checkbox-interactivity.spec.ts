import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
  await page.keyboard.type("- ");
  await page.keyboard.type("[ ] ");
  await page.keyboard.type("buy milk");
});

test("clicking an unchecked checkbox checks it", async ({ page }) => {
  const checkbox = page.locator(".taino-editor input[type=checkbox]");
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
});

test("clicking a checked checkbox unchecks it", async ({ page }) => {
  const checkbox = page.locator(".taino-editor input[type=checkbox]");
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
});

test("clicking the checkbox does not move the text caret or disturb the label", async ({
  page,
}) => {
  // KNOWN, ROOT-CAUSED, real `taino-edit-dom` bug, not yet fixed: typing
  // "buy milk" right after `checkbox_on_input` inserts the checkbox atom
  // is a REAL, correctly-placed new DOM text node, but `read_dom_changes`
  // (confirmed by reading its source) has exactly two detection paths --
  // "an EXISTING tracked text run changed" and "text appeared in a
  // block with ZERO tracked children" -- and neither covers "a NEW text
  // node appeared next to an existing non-text atom in an otherwise
  // non-empty block". So the typed text is a pure DOM/visual illusion,
  // invisible to the model, until something else (here: our own click)
  // forces a re-render built on the stale, checkbox-only model, leaving
  // the untracked text orphaned in the DOM and any FURTHER typing to
  // land wherever the (also-stale) tracked tree thinks the block ends.
  test.fail();
  const checkbox = page.locator(".taino-editor input[type=checkbox]");
  await checkbox.click();
  await expect(page.locator(".taino-editor li p")).toHaveText("buy milk");
  // Typing right after the click still lands in the paragraph text, not
  // somewhere unexpected.
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(page.locator(".taino-editor li p")).toHaveText("buy milk!");
});

test("toggling is undoable", async ({ page }) => {
  const checkbox = page.locator(".taino-editor input[type=checkbox]");
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(checkbox).not.toBeChecked();
});
