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
  // Regression test for a real, root-caused `taino-edit-dom` bug (now
  // patched -- see `vendor/taino-edit`, `[patch.crates-io]` in the
  // workspace `Cargo.toml`, and `find_empty_block_text` in
  // `vendor/taino-edit/crates/taino-edit-dom/src/view.rs`): typing "buy
  // milk" right after `checkbox_on_input` inserts the checkbox atom used
  // to be a REAL, correctly-placed new DOM text node that `read_dom_changes`
  // never detected -- it only diffed an EXISTING tracked text run, or
  // text appearing in a block with ZERO tracked children, and neither
  // covered "a NEW text node appeared next to an existing non-text atom
  // in an otherwise non-empty block". The typed text was a pure
  // DOM/visual illusion, invisible to the model, until something else
  // (here: our own click) forced a re-render built on the stale,
  // checkbox-only model, orphaning the untracked text in the DOM.
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
