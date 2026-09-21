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
});
