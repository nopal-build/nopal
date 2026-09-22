import { test, expect } from "@playwright/test";
import { gotoWithDoc } from "./helpers";

// Regression tests for a real bug: the caret could land immediately
// BEFORE a checkbox atom \u2014 never a meaningful position, since a
// checkbox is always its list item's own leading glyph (GFM's own
// `[ ]`/`[x]` is always the line's first thing; there's no way to
// represent text before it at all). See `commands.rs`'s own module doc
// comment (item 5) for the full root-cause writeup.

test("ArrowLeft from right after a checkbox never lands before it, even with nothing else in the list", async ({
  page,
}) => {
  await gotoWithDoc(page, "- [ ] hello\n");
  await page.locator(".taino-editor li p").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("x");

  // Nothing meaningful precedes the single item at all, so this
  // declines entirely \u2014 the "x" lands right after the checkbox, never
  // before it.
  await expect(page.locator(".taino-editor li p")).toHaveText("xhello");
});

test("ArrowLeft skips a leading checkbox, landing at the end of the preceding item's own text", async ({
  page,
}) => {
  await gotoWithDoc(page, "- [ ] first\n- [ ] second\n");
  const items = page.locator(".taino-editor li p");
  await items.nth(1).click();
  await page.keyboard.press("End");
  // Walk all the way back to right after the SECOND item's own
  // checkbox (deliberately NOT using Home here — that has its own,
  // separately-tested skip fix; this isolates ArrowLeft's).
  for (let i = 0; i < "second".length; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");

  await expect(items.nth(0)).toHaveText("first!");
  await expect(items.nth(1)).toHaveText("second");
});

test("Home never lands before a checkbox \u2014 it lands right after it when nothing precedes", async ({
  page,
}) => {
  await gotoWithDoc(page, "- [ ] hello\n");
  await page.locator(".taino-editor li p").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("x");

  await expect(page.locator(".taino-editor li p")).toHaveText("xhello");
  // The checkbox itself is untouched \u2014 still present, still the FIRST
  // element in the paragraph.
  await expect(page.locator(".ox-checkbox")).toHaveCount(1);
});

test("Home skips a leading checkbox and lands at the end of the preceding item when one exists", async ({
  page,
}) => {
  await gotoWithDoc(page, "- [ ] first\n- [ ] second\n");
  const items = page.locator(".taino-editor li p");
  await items.nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("!");

  await expect(items.nth(0)).toHaveText("first!");
  await expect(items.nth(1)).toHaveText("second");
});
