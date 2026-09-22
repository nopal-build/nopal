import { test, expect } from "@playwright/test";
import { gotoWithDoc } from "./helpers";

// Regression tests for a real bug: a directive atom (leaf_directive/
// text_directive) declares `content: Some("text*")` for its synthetic
// display label, so it is NOT a true zero-content atom \u2014 `atom: true`
// only ever governed this crate's OWN click handling
// (`directive_popover.rs`), never generic keyboard commands. A plain
// Text caret could end up trapped inside a directive's own content via
// ordinary ArrowLeft/Right navigation, and once there, Enter called
// `split_block` on it directly (reported as "pressing Enter adds a new
// Badge" \u2014 the directive split into two), and typing a character hit a
// genuinely corrupting native-Chrome code path. See `commands.rs`'s own
// module doc comment (item 4) for the full root-cause writeup.

test("pressing Enter after selecting a badge moves the caret out, never duplicates it", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Enter");

  // Still exactly one badge, never duplicated.
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await page.keyboard.type("!");
  await expect(page.locator(".taino-editor p")).toHaveText("!plain paragraph");
});

test("Enter after a badge with nothing else in the document creates a real landing paragraph", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".taino-editor p")).toHaveText("hello");
});

test("ArrowRight/ArrowDown always escape a selected directive, even with nothing after it", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("right");
  await expect(page.locator(".taino-editor p")).toHaveText("right");

  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("down");
  await expect(page.locator(".taino-editor p")).toHaveText("down");
});

test("ArrowLeft/ArrowUp escape backward, landing at the end of the preceding paragraph", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");
  await expect(page.locator(".taino-editor p").first()).toHaveText("before!");
});

test("pressing Space after selecting a badge escapes instead of corrupting the document", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");

  // The real bug produced literal <font>/<span style>/<b> garbage; the
  // fix must leave the document genuinely clean.
  const html = await page.locator(".taino-editor").innerHTML();
  expect(html).not.toContain("<font");
  expect(html).not.toContain("<b>");
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".taino-editor p").last()).toHaveText(
    " plain paragraph",
  );
});

test("a caret that lands inside a directive's own content via keyboard navigation still escapes cleanly on Enter", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  // Put a real caret at the end of "before", then arrow right/down twice:
  // once to reach the badge's own text, a second time to land INSIDE it
  // (the exact trap this bug lived in, reached without ever clicking).
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");

  // Still exactly one badge.
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
});
