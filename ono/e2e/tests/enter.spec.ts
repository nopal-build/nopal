import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test("Enter at the end of a heading exits to a plain paragraph", async ({
  page,
}) => {
  await page.keyboard.type("## ");
  await page.keyboard.type("Title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("body text");
  await expect(page.locator(".taino-editor h2")).toHaveText("Title");
  await expect(page.locator(".taino-editor p")).toHaveText("body text");
});

test("Enter inside a code block inserts a literal newline, not a new block", async ({
  page,
}) => {
  // No input rule for code fences yet — insert one the only way currently
  // possible: type inline code isn't a code_block, so this test documents
  // the CURRENT reachable path is out of scope until a real code-block
  // trigger exists. Skipped rather than faked with a fixture the app
  // itself can never produce via typing.
  test.skip(true, "no input rule creates a code_block yet — nothing to reach it with real typing");
});

test("Enter on an empty line inside a single-paragraph blockquote exits it", async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(0);
  await page.keyboard.type("outside");
  await expect(page.locator(".taino-editor p").last()).toHaveText("outside");
});

test("Enter on a trailing empty line in a multi-paragraph blockquote exits just that line", async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await page.keyboard.type("quoted text");
  await page.keyboard.press("Enter"); // new paragraph, still inside the quote
  await page.keyboard.press("Enter"); // that new paragraph is empty -> exit
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(1);
  await expect(page.locator(".taino-editor blockquote")).toContainText(
    "quoted text",
  );
  await page.keyboard.type("outside");
  await expect(page.locator(".taino-editor p").last()).toHaveText("outside");
});

test("multi-paragraph blockquotes accumulate paragraphs normally on Enter", async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(1);
  await expect(page.locator(".taino-editor blockquote p")).toHaveCount(2);
  await expect(page.locator(".taino-editor blockquote")).toContainText("first");
  await expect(page.locator(".taino-editor blockquote")).toContainText("second");
});
