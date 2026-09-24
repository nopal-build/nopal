import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test("Undo reverts the last edit and redo reapplies it", async ({ page }) => {
  await page.keyboard.type("hello");
  // Lowercase `z` matters: Playwright's `press("...+Z")` (capital)
  // synthesizes `event.key === "Z"` WITHOUT `shiftKey` — a real,
  // confirmed-by-testing Playwright gotcha, not an app bug (discovered
  // via this exact test originally using capital Z: our keymap binds
  // lowercase `"Mod-z"`, so the mismatched canonical key string meant
  // OUR handler never even ran, `preventDefault` was never called, and
  // the BROWSER's own native contenteditable undo fired instead —
  // producing bizarre, misleading results that looked like a real bug
  // at first).
  await page.keyboard.press("ControlOrMeta+z");
  // Each keystroke is currently its OWN undo group (a documented, known
  // follow-up — see `each_keystroke_is_its_own_undo_group_by_default` in
  // `commands.rs`), so one undo removes just the last character typed,
  // not the whole word.
  await expect(page.locator(".taino-editor p")).toHaveText("hell");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".taino-editor p")).toHaveText("hello");
});

test("Undo also reverts a structural edit (list conversion)", async ({
  page,
}) => {
  await page.keyboard.type("- ");
  await expect(page.locator(".taino-editor ul")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".taino-editor ul")).toHaveCount(0);
});
