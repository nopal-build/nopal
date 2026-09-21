import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

// There is deliberately NO soft/hard line-break distinction in this editor
// (see `shift_enter_fixups`'s own doc comment in `commands.rs`): Shift+Enter
// does EXACTLY what plain Enter does everywhere, except that it never
// exits/lifts out of a blockquote or list item on an empty line. An earlier
// `hard_break`/`<br>`-atom-based design was removed after hitting a real,
// confirmed `taino-edit-dom` bug (typing right after a trailing `<br>`
// merged into the preceding text run) — moot now that there's no atom at
// all.

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test("Shift+Enter in a plain paragraph behaves exactly like plain Enter", async ({
  page,
}) => {
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(page.locator(".taino-editor p")).toHaveCount(2);
  await expect(page.locator(".taino-editor p").nth(0)).toHaveText("first");
  await expect(page.locator(".taino-editor p").nth(1)).toHaveText("second");
});

test("Shift+Enter in a heading behaves exactly like plain Enter (exits to a paragraph)", async ({
  page,
}) => {
  await page.keyboard.type("## ");
  await page.keyboard.type("Title");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("body text");
  await expect(page.locator(".taino-editor h2")).toHaveText("Title");
  await expect(page.locator(".taino-editor p")).toHaveText("body text");
});

test("Shift+Enter on an empty line inside a blockquote does NOT exit (unlike plain Enter)", async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(1);
  await expect(page.locator(".taino-editor blockquote p")).toHaveCount(2);
  await page.keyboard.type("still inside");
  await expect(page.locator(".taino-editor blockquote p").nth(1)).toHaveText(
    "still inside",
  );
});

test("Shift+Enter in a list item splits within the same item, never creating a new bullet", async ({
  page,
}) => {
  await page.keyboard.type("- ");
  await page.keyboard.type("first line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");
  await expect(page.locator(".taino-editor li")).toHaveCount(1);
  await expect(page.locator(".taino-editor li p")).toHaveCount(2);
  await expect(page.locator(".taino-editor li p").nth(0)).toHaveText(
    "first line",
  );
  await expect(page.locator(".taino-editor li p").nth(1)).toHaveText(
    "second line",
  );
});
