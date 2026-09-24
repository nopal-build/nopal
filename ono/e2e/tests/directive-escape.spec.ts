import { test, expect } from "@playwright/test";
import { gotoWithDoc } from "./helpers";

// Regression tests for a real bug: a directive atom (leaf_directive/
// text_directive) declares `content: Some("text*")` for its synthetic
// display label, so it is NOT a true zero-content atom — `atom: true`
// only ever governed this crate's OWN click handling
// (`directive_popover.rs`), never generic keyboard commands. A plain
// Text caret could end up trapped inside a directive's own content via
// ordinary ArrowLeft/Right navigation, and once there, Enter called
// `split_block` on it directly (reported as "pressing Enter adds a new
// Badge" — the directive split into two), and typing a character hit a
// genuinely corrupting native-Chrome code path. See `commands.rs`'s own
// module doc comment (item 4) for the full root-cause writeup.
//
// Enter got its OWN escape shape after a second round of live feedback
// (item 4's later addendum): it ALWAYS inserts a fresh paragraph rather
// than reusing `exit_directive`'s arrow-key "land on whatever's already
// next" logic (which surprisingly jumped straight to selecting an
// unrelated adjacent directive).
//
// An intermediate design (items 4/6, since fully reverted) let Space
// enter a directive's content and type into it directly, with arrow
// keys moving freely within that content once inside. Item 7 reverses
// all of that, back to matching the `oxmarkdown` skill's own
// "Selection model" exactly: arrow-key navigation onto a directive
// always SELECTS it as a whole unit — never places a bare caret inside
// its content — and Space has no directive-specific action at all
// anymore (a directive's only listed action is "click/tap selects and
// shows a popover for editing its attributes"). See `commands.rs`'s own
// module doc comment, item 7, for the full writeup, including where the
// anti-corruption guard actually lives now (a generic, atom-level fix
// in the vendored `taino-edit-leptos` fork, not a per-key allowlist
// here).
//
// A THIRD entry point into this exact same "bare caret trapped inside a
// directive's content" trap was found and fixed after item 7 shipped:
// item 7 only ever closed it for KEYBOARD arrow navigation. Clicking in
// the empty space just past a leaf/text directive's own rendered pill
// (still the same row, but not actually on the pill) never reached
// `directive_popover.rs`'s existing `mousedown` check at all (that only
// matches a click resolving to the position immediately BEFORE the
// directive starts) — the browser's own native caret-from-point
// placement ran unopposed and landed a bare caret inside the directive's
// own text (confirmed live: `window.getSelection()` resolved into the
// pill's own last character), which the fork's `selection_touches_an_atom`
// guard then correctly blocked every further keystroke against — read
// live as "I can no longer add a new line or write anything." See
// `directive_popover.rs`'s own `handle_mouseup` doc comment for the fix.

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
  // existing one — "plain paragraph" itself is untouched.
  const paragraphs = page.locator(".taino-editor p");
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.nth(0)).toHaveText("!");
  await expect(paragraphs.nth(1)).toHaveText("plain paragraph");
});

test("pressing Enter next to an unrelated directive never jumps to selecting it — it always creates a new line", async ({
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

test("Space does nothing at all while a badge is selected — no label edit, no corruption", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("Space");

  // The real bug this whole mechanism guards against produced literal
  // <font>/<span style>/<b> garbage; the fix must leave the document
  // genuinely untouched, not just "still parseable."
  const html = await page.locator(".taino-editor").innerHTML();
  expect(html).not.toContain("<font");
  expect(html).not.toContain("<b>");
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});

test("typing an ordinary character while a badge is selected does nothing at all", async ({
  page,
}) => {
  // Confirms the fix lives at the generic atom level (the vendored
  // `taino-edit-leptos` fork's `selection_touches_an_atom`), not a
  // per-key allowlist that happened to only ever cover Space.
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.type("x");

  const html = await page.locator(".taino-editor").innerHTML();
  expect(html).not.toContain("<font");
  expect(html).not.toContain("<b>");
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});

test("ArrowRight from the preceding paragraph selects the directive as a unit, confirmed by Backspace removing it in one press", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  // If this landed a bare caret one level inside "Ready" (the old bug),
  // Backspace would delete just its last character. If it genuinely
  // selected the whole directive (the fix), Backspace removes it
  // outright, in one press, leaving "before" completely untouched.
  await page.keyboard.press("Backspace");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(0);
  await expect(page.locator(".taino-editor p").first()).toHaveText("before");
});

test("ArrowLeft from the following paragraph selects the preceding directive as a unit, confirmed by Backspace removing it in one press", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nafter\n');
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(0);
  await expect(page.locator(".taino-editor p").first()).toHaveText("after");
});

test("re-entering a directive via ArrowRight after exiting it backward selects it again, never landing a caret inside", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  await page.locator(".ox-directive-leaf").click();
  await page.keyboard.press("ArrowLeft"); // exit backward, landing at the end of "before"
  await page.keyboard.press("ArrowRight"); // re-enter — must SELECT, not land inside the label
  await page.keyboard.press("ArrowLeft"); // already selected — exits backward again
  await page.keyboard.type("!");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  await expect(page.locator(".taino-editor p").first()).toHaveText("before!");
});

test("a caret that reaches a directive's content via native vertical arrow movement self-heals into a selection, still escaping cleanly on Enter", async ({
  page,
}) => {
  await gotoWithDoc(page, 'before\n\n::badge{label="Ready"}\n');
  // ArrowDown is native browser vertical movement (no keymap hook to
  // peek at — a documented residual gap, see `commands.rs` item 5/7),
  // so it can still land a bare caret one level inside the badge's own
  // content directly. The very next ArrowRight must self-heal that into
  // a real selection rather than treating it as ordinary text.
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");

  // Still exactly one badge, label untouched.
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
});

test("clicking just past a badge's own rendered pill, on the same row, lands a real caret in the following paragraph instead of trapping it inside the label", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  const badge = page.locator(".ox-directive-leaf").first();
  const box = await badge.boundingBox();
  if (!box) throw new Error("badge has no bounding box");
  await page.mouse.click(box.x + box.width + 100, box.y + box.height / 2);

  // The label is completely untouched — the click never really landed
  // "on" the directive at all, so no popover, no selection of it either.
  await expect(page.locator(".ox-directive-popover")).toHaveCount(0);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  // A single typed character proves the caret is genuinely live and
  // sitting right at the start of "plain paragraph" (a single character
  // insertion, to avoid a separate, unrelated multi-character mid-line
  // typing bug this repro is not about).
  await page.keyboard.type("X");
  await expect(page.locator(".taino-editor p")).toHaveText("Xplain paragraph");
});

test("clicking just past a badge with nothing after it at all lands in a freshly inserted paragraph", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n');
  const badge = page.locator(".ox-directive-leaf").first();
  const box = await badge.boundingBox();
  if (!box) throw new Error("badge has no bounding box");
  await page.mouse.click(box.x + box.width + 100, box.y + box.height / 2);
  await page.keyboard.type("typed");

  await expect(page.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(page.locator(".ox-directive-leaf")).toHaveText("Ready");
  await expect(page.locator(".taino-editor p")).toHaveText("typed");
});

test("clicking squarely on the badge's own visible text still selects it and opens the popover, unaffected by the mouseup fix", async ({
  page,
}) => {
  await gotoWithDoc(page, '::badge{label="Ready"}\n\nplain paragraph\n');
  const badge = page.locator(".ox-directive-leaf").first();
  const box = await badge.boundingBox();
  if (!box) throw new Error("badge has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator(".ox-directive-popover")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".ox-directive-leaf")).toHaveCount(0);
  await expect(page.locator(".taino-editor p")).toHaveText("plain paragraph");
});
