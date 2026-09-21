import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor, caretParentTag } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test('typing "- " at the end of an empty line converts to a bullet list', async ({
  page,
}) => {
  // Real keyboard typing, not a synthetic DOM event — this is the ONLY way
  // to reproduce the real browser quirk this input rule once missed: a
  // space typed at the true end of a line (nothing after it) arrives as
  // `\u00A0` (non-breaking space), not a plain space, because the
  // browser's own contenteditable implementation substitutes it to avoid
  // the trailing space being visually collapsed away. A native Rust unit
  // test can assert against a literal `\u00A0` character once you know to
  // look for it, but can't discover that the browser does this at all —
  // that's what this whole suite exists for.
  await page.keyboard.type("- ");
  await expect(page.locator(".taino-editor ul")).toHaveCount(1);
});

test('typing "* " at the end of an empty line converts to a bullet list', async ({
  page,
}) => {
  await page.keyboard.type("* ");
  await expect(page.locator(".taino-editor ul")).toHaveCount(1);
});

test('typing "1. " at the end of an empty line converts to an ordered list', async ({
  page,
}) => {
  await page.keyboard.type("1. ");
  await expect(page.locator(".taino-editor ol")).toHaveCount(1);
});

test('typing "> " at the end of an empty line converts to a blockquote', async ({
  page,
}) => {
  await page.keyboard.type("> ");
  await expect(page.locator(".taino-editor blockquote")).toHaveCount(1);
});

test('typing "## " converts to a heading, with the caret actually INSIDE it', async ({
  page,
}) => {
  await page.keyboard.type("## ");
  await expect(page.locator(".taino-editor h2")).toHaveCount(1);
  // Regression check for the real bug: the caret used to land as a
  // SIBLING of the new <h2>, not inside it (visible in devtools as a bare
  // text node next to an empty heading — addable to, but not deletable,
  // since the underlying model position was outside any block at all).
  expect(await caretParentTag(page)).toBe("H2");
  // If the caret is genuinely inside the heading, subsequently typed text
  // ends up INSIDE the <h2>, not floating beside it.
  await page.keyboard.type("Title");
  await expect(page.locator(".taino-editor h2")).toHaveText("Title");
});

test('typing "### " converts to an <h3>', async ({ page }) => {
  await page.keyboard.type("### ");
  await expect(page.locator(".taino-editor h3")).toHaveCount(1);
});

test("plain typing with no trigger sequence never converts the line", async ({
  page,
}) => {
  await page.keyboard.type("just some prose - not a list");
  await expect(page.locator(".taino-editor ul")).toHaveCount(0);
  await expect(page.locator(".taino-editor p")).toHaveText(
    "just some prose - not a list",
  );
});
