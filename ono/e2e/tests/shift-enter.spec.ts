import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test("Shift+Enter inserts a line break without splitting the paragraph", async ({
  page,
}) => {
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(page.locator(".taino-editor p")).toHaveCount(1);
  await expect(page.locator(".taino-editor p br")).toHaveCount(1);
  // The STRONGER, order-sensitive check: merely counting <br> elements
  // (above) is not enough to catch a real, confirmed bug in
  // `taino-edit-dom`'s live incremental DOM patcher (see
  // `hard_break_followed_by_more_typing_keeps_correct_order` in
  // `commands.rs` for the full root-cause writeup) — typing immediately
  // after a hard break can merge the new text into the PRECEDING run and
  // push the <br> to the very end ("first<br>second" becomes
  // "firstsecond<br>"), which still has exactly one <p> and one <br>.
  test.fail();
  expect(await page.locator(".taino-editor p").innerHTML()).toBe(
    "first<br>second",
  );
});

test("Shift+Enter inside a heading stays inside the heading", async ({
  page,
}) => {
  await page.keyboard.type("## ");
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(page.locator(".taino-editor h2")).toHaveCount(1);
  await expect(page.locator(".taino-editor h2 br")).toHaveCount(1);
  test.fail(); // see the paragraph test above for the full writeup
  expect(await page.locator(".taino-editor h2").innerHTML()).toBe(
    "first<br>second",
  );
});

test("Shift+Enter inside a blockquote stays inside it (no exit)", async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(1);
  await expect(page.locator(".taino-editor blockquote br")).toHaveCount(1);
  test.fail(); // see the paragraph test above for the full writeup
  expect(await page.locator(".taino-editor blockquote p").innerHTML()).toBe(
    "first<br>second",
  );
});
