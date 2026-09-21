import type { Page } from "@playwright/test";

/**
 * Loads the editor with a small, single-paragraph starting doc instead of
 * the large, evolving `DEFAULT_SAMPLE` — see `initial_markdown()`'s own
 * doc comment in `oxmarkdown-editor/src/lib.rs` for why this query param
 * exists at all (purely to make these tests hermetic and independent of
 * that sample's own content).
 */
export async function gotoWithDoc(page: Page, markdown: string) {
  await page.goto(`/?doc=${encodeURIComponent(markdown)}`);
  await page.locator(".taino-editor").waitFor();
}

/**
 * Selects everything and deletes it, leaving one empty paragraph — a
 * clean slate for tests that care about typing from nothing (input
 * rules, Enter's exit-to-paragraph behavior) without depending on
 * whatever starting text `gotoWithDoc` was given.
 */
export async function clearEditor(page: Page) {
  await page.locator(".taino-editor").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
}

/**
 * The tag name of the DOM element the caret currently sits inside — the
 * exact signal that caught the real "caret lands outside the `<h2>`" bug
 * (see `commands.rs`'s own doc comment on `heading_type_on_input`), which
 * no purely model-level (`ResolvedPos`) native test can observe, since
 * that bug was specifically about the live DOM/browser selection, not
 * `taino-edit-core`'s own document model.
 */
export async function caretParentTag(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!node) return null;
    const el =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return el?.tagName ?? null;
  });
}
