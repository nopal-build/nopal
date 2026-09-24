import { test, expect } from "@playwright/test";
import { gotoWithDoc } from "./helpers";

// Regression tests for a real, general bug found while investigating a
// directive-specific report (see `directive-escape.spec.ts`'s own notes
// on clicking past a badge): typing MULTIPLE characters immediately
// after landing a caret in the middle of a line, with real text still
// AFTER the caret, could scramble the typed word — confirmed to
// reproduce via a PURE keyboard flow (click once to focus, `Home`, then
// type), with zero directive/`ViewAction`/`ViewPlugin` involvement at
// all, so this was never actually about directives, clicking, or this
// crate's own code. Typing at the very END of a line (nothing after the
// caret) was always unaffected.
//
// Root-caused in the vendored `taino-edit-dom` fork's own
// `read_dom_changes`: it detects a typed edit by diffing the OLD model
// text against the NEW live DOM text as two plain strings (longest
// common prefix + longest common suffix), with NO awareness of where
// the browser's own caret actually is. Whenever the newly typed
// character(s) share a character with their own immediate neighborhood
// (e.g. typing a second "p" two characters before an existing "p"), the
// prefix/suffix match is genuinely AMBIGUOUS — two different edit
// positions produce the exact same resulting text, but only one matches
// where the caret really is — and the unanchored algorithm always
// resolved that ambiguity by picking the position least visually
// obvious a proxy would guess (the LATER one), which happens to be
// wrong here. The wrong position doesn't corrupt the visible TEXT (both
// candidate edits produce identical text), but it desyncs the MODEL's
// own notion of where the caret sits, one character at a time, visibly
// scrambling every keystroke after the first ambiguous one.
//
// Fixed with `find_diff_anchored` (`taino-edit-dom/src/view.rs`): when
// the text grew and the browser's own current (collapsed) caret is
// known, the edit's positions are derived DIRECTLY from that caret
// (which always sits right after what was just typed) instead of
// guessed at via string matching — verified against both strings before
// being trusted, falling straight through to the original, unanchored
// diff whenever that verification fails or no usable caret is
// available (composition, paste, spellcheck/autocomplete, deletions).

test("typing multiple characters after clicking in the MIDDLE of a line does not scramble them", async ({
  page,
}) => {
  await gotoWithDoc(page, "plain paragraph\n");
  const p = page.locator(".taino-editor p").first();
  await p.click({ position: { x: 40, y: 5 } });
  await page.keyboard.type("typed");
  await expect(p).toHaveText("plain typedparagraph");
});

test("typing multiple characters after Home (start of line, more text after the caret) does not scramble them", async ({
  page,
}) => {
  await gotoWithDoc(page, "plain paragraph\n");
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("typed");
  await expect(page.locator(".taino-editor p").first()).toHaveText(
    "typedplain paragraph",
  );
});

test("typing a word that shares characters with its own surrounding text (the exact ambiguous case) still lands correctly", async ({
  page,
}) => {
  // "banana" typed right before "banana": every possible rotation of
  // "nanab" shares characters with its own neighbors, the worst case for
  // a plain prefix/suffix string diff.
  await gotoWithDoc(page, "banana\n");
  const p = page.locator(".taino-editor p").first();
  await p.click({ position: { x: 2, y: 5 } });
  await page.keyboard.type("nanab");
  await expect(p).toHaveText("nanabbanana");
});

test("typing at the very END of a line (nothing after the caret) still works, unchanged", async ({
  page,
}) => {
  await gotoWithDoc(page, "plain paragraph\n");
  await page.locator(".taino-editor p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("typed");
  await expect(page.locator(".taino-editor p").first()).toHaveText(
    "plain paragraphtyped",
  );
});
