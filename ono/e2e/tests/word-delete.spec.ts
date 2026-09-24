import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

// `Alt+Backspace`/`Alt+Delete` — not `Meta`/`ControlOrMeta` — because
// `EditingFixups` binds BOTH the mac convention (Option/Alt) and the
// Windows/Linux one (Ctrl) to the SAME command (see `commands.rs`), so
// testing with `Alt` works regardless of which OS the runner is on.

test("Option/Ctrl+Backspace deletes the previous word", async ({ page }) => {
  await page.keyboard.type("hello world");
  await page.keyboard.press("Alt+Backspace");
  await expect(page.locator(".taino-editor p")).toHaveText("hello ");
});

test("Option/Ctrl+Backspace also eats trailing whitespace before the word", async ({
  page,
}) => {
  await page.keyboard.type("hello world  ");
  await page.keyboard.press("Alt+Backspace");
  await expect(page.locator(".taino-editor p")).toHaveText("hello ");
});

test("Option/Ctrl+Delete deletes the next word", async ({ page }) => {
  await page.keyboard.type("hello world");
  await page.keyboard.press("Home");
  await page.keyboard.press("Alt+Delete");
  await expect(page.locator(".taino-editor p")).toHaveText(" world");
});

test("plain Backspace/Delete are unaffected (still delete one character)", async ({
  page,
}) => {
  await page.keyboard.type("hi");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".taino-editor p")).toHaveText("h");
});
