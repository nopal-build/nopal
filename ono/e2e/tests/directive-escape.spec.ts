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
//
// Enter and Space each got their OWN escape shape after a second round
// of live feedback (item 4's later addendum): Enter ALWAYS inserts a
// fresh paragraph rather than reusing `exit_directive`'s arrow-key
// "land on whatever's already next" logic (which surprisingly jumped
// straight to selecting an unrelated adjacent directive), and Space's
// FIRST press appends to the directive's own visible content instead
// of exiting immediately.
//
// A third round of live feedback (item 6) found the design above was
// STILL wrong once combined with "I should be able to arrow around to
// edit the contents": a second Space used to force-exit the directive,
// and arrow keys used to exit unconditionally the moment the caret was
// already inside the content, rather than moving within it. Now, once
// a real caret is inside a directive's content, it behaves like any
// other text caret: Space/typing just extends the label, and arrow
// keys move normally within the content, only exiting once they'd
// cross the content's true start/end edge.

test("pressing Enter after selecting a badge always inserts a fresh new line, never reuses or jumps to what's already next", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");

  // Still exactly one badge, never duplicated.
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  // A BRAND NEW paragraph was inserted between the badge and the
  // existing one \u2014 "plain paragraph" itself is untouched.
  const paragraphs = page.locator(".taino-editor p");
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.nth(0)).toHaveText("!");
  await expect(paragraphs.nth(1)).toHaveText("plain paragraph");
});

test("pressing Enter next to an unrelated directive never jumps to selecting it \u2014 it always creates a new line", async ({
  page,
}) => {
  // The exact reported scenario: a badge sitting right next to a
  // completely unrelated gallery directive.
  await gotoWithDoc(
    page,
    '::badge{label="Ready"}\n\n:::gallery{max-columns="3"}\nhi\n:::\n',
  );
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-container")).toHaveCount(1);
  const paragraphs = page.locator(".taino-editor > p");
  await expect(paragraphs).toHaveCount(1);
  await expect(paragraphs.first()).toHaveText("hello");
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

test("the first Space after selecting a badge appends to its own label instead of corrupting the document", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Space");

  // The real bug produced literal <font>/<span style>/<b> garbage; the
  // fix must leave the document genuinely clean.
  const html = await page.locator(".taino-editor").innerHTML();
  expect(html).not.toContain("<font");
  expect(html).not.toContain("<b>");
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready ");
  // The second (existing) paragraph is untouched \u2014 the first Space
  // only edited the badge's own content.
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});

test("a second Space (right after the first) no longer exits — it just extends the label like ordinary typing", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.keyboard.type("!");

  // Still exactly one badge, its label now extended with two spaces and
  // the typed "!" — nothing exited, nothing duplicated.
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready  !");
  // The existing paragraph is completely untouched.
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});

test("once inside a directive's content, ArrowLeft/ArrowRight move the caret within it instead of exiting", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Space");
  // Caret now sits right after "Ready " (inside the content, not at the
  // very start edge). Move left twice, then type — this should land in
  // the MIDDLE of the label, not exit the directive.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Read!y ");
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});

test("ArrowLeft at the true start edge of a directive's content still exits backward", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("ArrowLeft"); // exit backward, landing at the end of "before"
  await page.keyboard.press("ArrowRight"); // re-enter forward, landing right at the content start edge
  await page.keyboard.press("ArrowLeft"); // at the start edge already — this should exit again
  await page.keyboard.type("!");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  await expect(page.locator(".taino-editor p").first()).toHaveText("before!");
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
