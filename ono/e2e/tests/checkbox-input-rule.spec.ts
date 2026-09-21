import { test, expect } from "@playwright/test";
import { gotoWithDoc, clearEditor } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoWithDoc(page, "placeholder");
  await clearEditor(page);
});

test('typing "- " then "[ ] " creates a real checkbox in a bullet list', async ({
  page,
}) => {
  await page.keyboard.type("- ");
  await expect(page.locator(".taino-editor ul")).toHaveCount(1);
  await page.keyboard.type("[ ] ");
  await expect(page.locator(".taino-editor input[type=checkbox]")).toHaveCount(
    1,
  );
  await expect(
    page.locator(".taino-editor input[type=checkbox]"),
  ).not.toBeChecked();
  await page.keyboard.type("do the thing");
  await expect(page.locator(".taino-editor li p")).toHaveText("do the thing");
});

test('typing "[x] " creates a CHECKED checkbox', async ({ page }) => {
  await page.keyboard.type("- ");
  await page.keyboard.type("[x] ");
  await expect(
    page.locator(".taino-editor input[type=checkbox]"),
  ).toBeChecked();
});

test('bare "[ ] " with no list marker never becomes a checkbox', async ({
  page,
}) => {
  await page.keyboard.type("[ ] hello");
  await expect(page.locator(".taino-editor input[type=checkbox]")).toHaveCount(
    0,
  );
  await expect(page.locator(".taino-editor p")).toHaveText("[ ] hello");
});
